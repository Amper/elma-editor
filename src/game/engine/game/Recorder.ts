/**
 * Replay recording at 30 FPS - ported from recorder.cpp store/recall logic.
 */
import { Vec2 } from '../core/Vec2';
import {
  POSITION_RATIO, WHEEL_ROTATION_RANGE, WHEEL_ROTATION_RATIO,
  BIKE_ROTATION_RANGE, BIKE_ROTATION_RATIO, MOTOR_FREQUENCY_RATIO,
  FRICTION_VOLUME_RATIO, TIME_TO_FRAME_INDEX, FRAME_INDEX_TO_TIME,
} from '../core/Constants';
import { WavEvent } from './EventBuffer';
import type { MotorState } from '../physics/MotorState';
import type { FrameData, ReplayEvent } from '../formats/ReplayFormat';
import { FLAG_GAS, FLAG_FLIPPED } from '../formats/ReplayFormat';

export interface BikeSound {
  motorFrequency: number;
  gas: boolean;
  frictionVolume: number;
}

export class Recorder {
  frames: FrameData[] = [];
  events: ReplayEvent[] = [];
  levelFilename = '';

  private finished = false;
  private previousBikeR = new Vec2();
  private previousFrameTime = 0;
  private nextFrameTime = 0;
  private nextFrameIndex = 0;
  private currentEventIndex = 0;
  private _flagTag = false;

  get frameCount(): number {
    return this.frames.length;
  }

  get isEmpty(): boolean {
    return this.frames.length === 0;
  }

  get flagTag(): boolean {
    return this._flagTag;
  }

  set flagTag(value: boolean) {
    this._flagTag = value;
  }

  erase(levFilename: string): void {
    this.levelFilename = levFilename;
    this.frames = [];
    this.events = [];
    this.finished = false;
    this.currentEventIndex = 0;
    this.nextFrameIndex = 0;
  }

  rewind(): void {
    this.finished = false;
    this.currentEventIndex = 0;
    this.nextFrameIndex = 0;
  }

  /** Recall a frame from recorded data (for replay playback) */
  recallFrame(mot: MotorState, time: number, sound: BikeSound): boolean {
    if (this.frames.length <= 0) throw new Error('No frames to recall');

    let index1 = Math.floor(TIME_TO_FRAME_INDEX * time);
    let index2Weight = TIME_TO_FRAME_INDEX * time - index1;
    index2Weight = Math.max(index2Weight, 0);
    index2Weight = Math.min(index2Weight, 1);
    const index1Weight = 1.0 - index2Weight;
    let index2 = index1 + 1;

    index1 = Math.max(index1, 0);
    index2 = Math.max(index2, 0);

    if (this.finished) {
      sound.motorFrequency = 1.0;
      sound.gas = false;
      sound.frictionVolume = 0;
      return false;
    }

    if (index1 >= this.frames.length - 1) {
      index1 = this.frames.length - 1;
      this.finished = true;
    }
    index2 = Math.min(index2, this.frames.length - 1);

    const f1 = this.frames[index1]!;
    const f2 = this.frames[index2]!;

    mot.bike.r.x = f1.bikeX * index1Weight + f2.bikeX * index2Weight;
    mot.bike.r.y = f1.bikeY * index1Weight + f2.bikeY * index2Weight;

    let interp: number;
    interp = f1.leftWheelX * index1Weight + f2.leftWheelX * index2Weight;
    mot.leftWheel.r.x = mot.bike.r.x + interp / POSITION_RATIO;
    interp = f1.leftWheelY * index1Weight + f2.leftWheelY * index2Weight;
    mot.leftWheel.r.y = mot.bike.r.y + interp / POSITION_RATIO;

    interp = f1.rightWheelX * index1Weight + f2.rightWheelX * index2Weight;
    mot.rightWheel.r.x = mot.bike.r.x + interp / POSITION_RATIO;
    interp = f1.rightWheelY * index1Weight + f2.rightWheelY * index2Weight;
    mot.rightWheel.r.y = mot.bike.r.y + interp / POSITION_RATIO;

    interp = f1.bodyX * index1Weight + f2.bodyX * index2Weight;
    mot.bodyR.x = mot.bike.r.x + interp / POSITION_RATIO;
    interp = f1.bodyY * index1Weight + f2.bodyY * index2Weight;
    mot.bodyR.y = mot.bike.r.y + interp / POSITION_RATIO;

    // Interpolate bike rotation (handle wraparound)
    let bikeRot1 = f1.bikeRotation;
    let bikeRot2 = f2.bikeRotation;
    if (Math.abs(bikeRot1 - bikeRot2) > BIKE_ROTATION_RANGE / 2) {
      if (bikeRot1 > bikeRot2) bikeRot1 -= BIKE_ROTATION_RANGE;
      else bikeRot2 -= BIKE_ROTATION_RANGE;
    }
    interp = bikeRot1 * index1Weight + bikeRot2 * index2Weight;
    mot.bike.rotation = interp / BIKE_ROTATION_RATIO;

    // Interpolate wheel rotations (handle wraparound)
    let leftRot1 = f1.leftWheelRotation;
    let leftRot2 = f2.leftWheelRotation;
    if (Math.abs(leftRot1 - leftRot2) > WHEEL_ROTATION_RANGE / 2) {
      if (leftRot1 > leftRot2) leftRot1 -= WHEEL_ROTATION_RANGE;
      else leftRot2 -= WHEEL_ROTATION_RANGE;
    }
    interp = leftRot1 * index1Weight + leftRot2 * index2Weight;
    mot.leftWheel.rotation = interp / WHEEL_ROTATION_RATIO;

    let rightRot1 = f1.rightWheelRotation;
    let rightRot2 = f2.rightWheelRotation;
    if (Math.abs(rightRot1 - rightRot2) > WHEEL_ROTATION_RANGE / 2) {
      if (rightRot1 > rightRot2) rightRot1 -= WHEEL_ROTATION_RANGE;
      else rightRot2 -= WHEEL_ROTATION_RANGE;
    }
    interp = rightRot1 * index1Weight + rightRot2 * index2Weight;
    mot.rightWheel.rotation = interp / WHEEL_ROTATION_RATIO;

    sound.gas = ((f1.flags >> FLAG_GAS) & 1) !== 0;
    mot.flippedBike = ((f1.flags >> FLAG_FLIPPED) & 1) !== 0;

    sound.motorFrequency = 1.0 + f1.motorFrequency / MOTOR_FREQUENCY_RATIO;
    sound.frictionVolume = f1.frictionVolume / FRICTION_VOLUME_RATIO;

    return true;
  }

  /** Store frames during recording */
  storeFrames(mot: MotorState, time: number, sound: BikeSound): void {
    if (!this.nextFrameIndex) {
      this.previousBikeR = mot.bike.r.clone();
      this.previousFrameTime = -1e-11;
      this.nextFrameTime = 0;
    }
    if (time < this.nextFrameTime) {
      this.previousBikeR = mot.bike.r.clone();
      this.previousFrameTime = time;
      return;
    }

    while (true) {
      const interpolatedBikeR = mot.bike.r.sub(this.previousBikeR)
        .scale((this.nextFrameTime - this.previousFrameTime) / (time - this.previousFrameTime))
        .add(this.previousBikeR);

      const frame: FrameData = {
        bikeX: interpolatedBikeR.x,
        bikeY: interpolatedBikeR.y,
        leftWheelX: Math.round((mot.leftWheel.r.x - mot.bike.r.x) * POSITION_RATIO),
        leftWheelY: Math.round((mot.leftWheel.r.y - mot.bike.r.y) * POSITION_RATIO),
        rightWheelX: Math.round((mot.rightWheel.r.x - mot.bike.r.x) * POSITION_RATIO),
        rightWheelY: Math.round((mot.rightWheel.r.y - mot.bike.r.y) * POSITION_RATIO),
        bodyX: Math.round((mot.bodyR.x - mot.bike.r.x) * POSITION_RATIO),
        bodyY: Math.round((mot.bodyR.y - mot.bike.r.y) * POSITION_RATIO),
        bikeRotation: 0,
        leftWheelRotation: 0,
        rightWheelRotation: 0,
        flags: 0,
        motorFrequency: 0,
        frictionVolume: 0,
      };

      // Bike rotation (0-9999)
      let bikeRot = mot.bike.rotation;
      while (bikeRot <= 0) bikeRot += 2 * Math.PI;
      while (bikeRot > 2 * Math.PI) bikeRot -= 2 * Math.PI;
      frame.bikeRotation = Math.round(bikeRot * BIKE_ROTATION_RATIO);

      // Wheel rotations
      if (mot.leftWheel.rotation <= 0) {
        frame.leftWheelRotation = Math.round((mot.leftWheel.rotation + 2 * Math.PI) * WHEEL_ROTATION_RATIO) & 0xFF;
      } else {
        frame.leftWheelRotation = Math.round(mot.leftWheel.rotation * WHEEL_ROTATION_RATIO) & 0xFF;
      }
      if (mot.rightWheel.rotation <= 0) {
        frame.rightWheelRotation = Math.round((mot.rightWheel.rotation + 2 * Math.PI) * WHEEL_ROTATION_RATIO) & 0xFF;
      } else {
        frame.rightWheelRotation = Math.round(mot.rightWheel.rotation * WHEEL_ROTATION_RATIO) & 0xFF;
      }

      // Flags
      frame.flags = 0;
      if (sound.gas) frame.flags |= (1 << FLAG_GAS);
      if (mot.flippedBike) frame.flags |= (1 << FLAG_FLIPPED);

      frame.motorFrequency = Math.round(MOTOR_FREQUENCY_RATIO * Math.max(sound.motorFrequency - 1.0, 0));
      frame.frictionVolume = Math.round(FRICTION_VOLUME_RATIO * sound.frictionVolume);

      this.frames.push(frame);
      this.nextFrameIndex++;
      this.nextFrameTime += FRAME_INDEX_TO_TIME;

      if (time < this.nextFrameTime) {
        this.previousBikeR = mot.bike.r.clone();
        this.previousFrameTime = time;
        return;
      }
    }
  }

  storeEvent(time: number, eventId: WavEvent, volume: number, objectId: number): void {
    this.events.push({ time, objectId, eventId, volume });
  }

  /** Recall next event (for forward playback) */
  recallEvent(time: number): { eventId: WavEvent; volume: number; objectId: number } | null {
    if (this.currentEventIndex < this.events.length) {
      if (this.events[this.currentEventIndex]!.time <= time) {
        const evt = this.events[this.currentEventIndex]!;
        this.currentEventIndex++;
        return { eventId: evt.eventId, volume: evt.volume, objectId: evt.objectId };
      }
    }
    return null;
  }

  /** Recall events in reverse (for rewind) */
  recallEventReverse(time: number): { eventId: WavEvent; volume: number; objectId: number } | null {
    if (this.currentEventIndex > 0 && this.events[this.currentEventIndex - 1]!.time > time) {
      this.currentEventIndex--;
      const evt = this.events[this.currentEventIndex]!;
      return { eventId: evt.eventId, volume: evt.volume, objectId: evt.objectId };
    }
    return null;
  }

  findLastTurnFrameTime(time: number): number {
    let index = Math.min(Math.floor(TIME_TO_FRAME_INDEX * time), this.frames.length - 1);
    index = Math.max(index, 0);
    const currentFlipped = (this.frames[index]!.flags >> FLAG_FLIPPED) & 1;
    for (let i = index - 1; i >= 0; i--) {
      const prevFlipped = (this.frames[i]!.flags >> FLAG_FLIPPED) & 1;
      if (prevFlipped !== currentFlipped) {
        return (i + 1) * FRAME_INDEX_TO_TIME;
      }
    }
    return -1000.0;
  }

  findLastVoltTime(time: number): { time: number; isRightVolt: boolean } {
    for (let i = this.currentEventIndex; i >= 0; i--) {
      if (i >= this.events.length) continue;
      if (this.events[i]!.time > time) continue;
      if (this.events[i]!.eventId === WavEvent.RightVolt) {
        return { time: this.events[i]!.time, isRightVolt: true };
      }
      if (this.events[i]!.eventId === WavEvent.LeftVolt) {
        return { time: this.events[i]!.time, isRightVolt: false };
      }
    }
    return { time: -1000.0, isRightVolt: true };
  }
}