/**
 * .rec binary parser/writer - ported from recorder.cpp
 *
 * Replay file format:
 *   Per-bike record:
 *     Frame count (int32)
 *     Version (int32, must be 131)
 *     Multiplayer flag (int32)
 *     Flag tag (int32)
 *     Level ID (int32)
 *     Level filename (16 bytes)
 *     Column-oriented frame data (all bike_x, then all bike_y, etc.)
 *     Event count (int32)
 *     Events (16 bytes each)
 *     Magic number (int32, 4796277)
 *
 *   Multiplayer replays contain two consecutive bike records.
 */
import { BinaryReader, BinaryWriter } from '../core/BinaryReader';
import { WavEvent } from '../game/EventBuffer';

const MAGIC_NUMBER = 4796277;

export const FLAG_GAS = 0;
export const FLAG_FLIPPED = 1;
export const FLAG_FLAGTAG_A = 2;
export const FLAG_FLAGTAG_IMMUNITY = 3;

export interface FrameData {
  bikeX: number;     // float32
  bikeY: number;     // float32
  leftWheelX: number;  // int16 (offset from bike * 1000)
  leftWheelY: number;  // int16
  rightWheelX: number; // int16
  rightWheelY: number; // int16
  bodyX: number;       // int16
  bodyY: number;       // int16
  bikeRotation: number;       // int16 (0-9999)
  leftWheelRotation: number;  // uint8 (0-249)
  rightWheelRotation: number; // uint8 (0-249)
  flags: number;              // uint8
  motorFrequency: number;     // uint8
  frictionVolume: number;     // uint8
}

export interface ReplayEvent {
  time: number;     // float64
  objectId: number; // int16
  eventId: WavEvent;
  volume: number;   // float32
}

export interface ReplayData {
  frameCount: number;
  frames: FrameData[];
  events: ReplayEvent[];
  levelFilename: string;
  levelId: number;
  isMultiplayer: boolean;
  isFlagTag: boolean;
}

export interface ReplayFile {
  rec1: ReplayData;
  rec2: ReplayData | null;
}

function loadOneReplay(reader: BinaryReader, _isFirst: boolean): { data: ReplayData; isMultiplayer: boolean } {
  const frameCount = reader.readInt32();
  if (frameCount <= 0) throw new Error('Invalid frame count');

  const version = reader.readInt32();
  if (version !== 131) throw new Error(`Unsupported replay version: ${version}`);

  const multiplayer = reader.readInt32();
  const flagTag = reader.readInt32();
  const levelId = reader.readInt32();
  const levelFilename = reader.readString(16);

  // Read column-oriented frame data
  const frames: FrameData[] = new Array(frameCount);
  for (let i = 0; i < frameCount; i++) {
    frames[i] = {} as FrameData;
  }

  // bike_x (float32)
  for (let i = 0; i < frameCount; i++) frames[i]!.bikeX = reader.readFloat32();
  // bike_y (float32)
  for (let i = 0; i < frameCount; i++) frames[i]!.bikeY = reader.readFloat32();
  // left_wheel_x (int16)
  for (let i = 0; i < frameCount; i++) frames[i]!.leftWheelX = reader.readInt16();
  // left_wheel_y (int16)
  for (let i = 0; i < frameCount; i++) frames[i]!.leftWheelY = reader.readInt16();
  // right_wheel_x (int16)
  for (let i = 0; i < frameCount; i++) frames[i]!.rightWheelX = reader.readInt16();
  // right_wheel_y (int16)
  for (let i = 0; i < frameCount; i++) frames[i]!.rightWheelY = reader.readInt16();
  // body_x (int16)
  for (let i = 0; i < frameCount; i++) frames[i]!.bodyX = reader.readInt16();
  // body_y (int16)
  for (let i = 0; i < frameCount; i++) frames[i]!.bodyY = reader.readInt16();
  // bike_rotation (int16)
  for (let i = 0; i < frameCount; i++) frames[i]!.bikeRotation = reader.readInt16();
  // left_wheel_rotation (uint8)
  for (let i = 0; i < frameCount; i++) frames[i]!.leftWheelRotation = reader.readUint8();
  // right_wheel_rotation (uint8)
  for (let i = 0; i < frameCount; i++) frames[i]!.rightWheelRotation = reader.readUint8();
  // flags (uint8)
  for (let i = 0; i < frameCount; i++) frames[i]!.flags = reader.readUint8();
  // motor_frequency (uint8)
  for (let i = 0; i < frameCount; i++) frames[i]!.motorFrequency = reader.readUint8();
  // friction_volume (uint8)
  for (let i = 0; i < frameCount; i++) frames[i]!.frictionVolume = reader.readUint8();

  // Events
  const eventCount = reader.readInt32();
  const events: ReplayEvent[] = [];

  for (let i = 0; i < eventCount; i++) {
    const time = reader.readFloat64();
    const objectId = reader.readInt16();
    const eventIdRaw = reader.readUint8();
    reader.skip(1); // padding
    const volume = reader.readFloat32();

    events.push({
      time,
      objectId,
      eventId: eventIdRaw as WavEvent,
      volume,
    });
  }

  // Magic number verification
  const magic = reader.readInt32();
  if (magic !== MAGIC_NUMBER) {
    throw new Error('Invalid replay magic number');
  }

  return {
    data: {
      frameCount,
      frames,
      events,
      levelFilename,
      levelId,
      isMultiplayer: multiplayer !== 0,
      isFlagTag: flagTag !== 0,
    },
    isMultiplayer: multiplayer !== 0,
  };
}

export function parseReplayFile(buffer: ArrayBuffer): ReplayFile {
  const reader = new BinaryReader(buffer);

  const { data: rec1, isMultiplayer } = loadOneReplay(reader, true);

  let rec2: ReplayData | null = null;
  if (isMultiplayer && reader.remaining > 4) {
    const { data } = loadOneReplay(reader, false);
    rec2 = data;
  }

  return { rec1, rec2 };
}

function writeOneReplay(writer: BinaryWriter, data: ReplayData, isMultiplayer: boolean): void {
  writer.writeInt32(data.frameCount);
  writer.writeInt32(131); // version
  writer.writeInt32(isMultiplayer ? 1 : 0);
  writer.writeInt32(data.isFlagTag ? 1 : 0);
  writer.writeInt32(data.levelId);
  writer.writeString(data.levelFilename, 16);

  // Write column-oriented frame data
  for (let i = 0; i < data.frameCount; i++) writer.writeFloat32(data.frames[i]!.bikeX);
  for (let i = 0; i < data.frameCount; i++) writer.writeFloat32(data.frames[i]!.bikeY);
  for (let i = 0; i < data.frameCount; i++) writer.writeInt16(data.frames[i]!.leftWheelX);
  for (let i = 0; i < data.frameCount; i++) writer.writeInt16(data.frames[i]!.leftWheelY);
  for (let i = 0; i < data.frameCount; i++) writer.writeInt16(data.frames[i]!.rightWheelX);
  for (let i = 0; i < data.frameCount; i++) writer.writeInt16(data.frames[i]!.rightWheelY);
  for (let i = 0; i < data.frameCount; i++) writer.writeInt16(data.frames[i]!.bodyX);
  for (let i = 0; i < data.frameCount; i++) writer.writeInt16(data.frames[i]!.bodyY);
  for (let i = 0; i < data.frameCount; i++) writer.writeInt16(data.frames[i]!.bikeRotation);
  for (let i = 0; i < data.frameCount; i++) writer.writeUint8(data.frames[i]!.leftWheelRotation);
  for (let i = 0; i < data.frameCount; i++) writer.writeUint8(data.frames[i]!.rightWheelRotation);
  for (let i = 0; i < data.frameCount; i++) writer.writeUint8(data.frames[i]!.flags);
  for (let i = 0; i < data.frameCount; i++) writer.writeUint8(data.frames[i]!.motorFrequency);
  for (let i = 0; i < data.frameCount; i++) writer.writeUint8(data.frames[i]!.frictionVolume);

  // Events
  writer.writeInt32(data.events.length);
  for (const evt of data.events) {
    writer.writeFloat64(evt.time);
    writer.writeInt16(evt.objectId);
    writer.writeUint8(evt.eventId);
    writer.writeUint8(0); // padding
    writer.writeFloat32(evt.volume);
  }

  writer.writeInt32(MAGIC_NUMBER);
}

export function writeReplayFile(replay: ReplayFile): ArrayBuffer {
  const writer = new BinaryWriter();
  const isMultiplayer = replay.rec2 !== null;
  writeOneReplay(writer, replay.rec1, isMultiplayer);
  if (replay.rec2) {
    writeOneReplay(writer, replay.rec2, true);
  }
  return writer.toArrayBuffer();
}