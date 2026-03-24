/**
 * Camera follow with flip animation.
 * Handles smooth transitions when the bike turns direction.
 */

export interface Camera {
  x: number;
  y: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  zoom: number;
}

export function createCamera(): Camera {
  return {
    x: 0,
    y: 0,
    minX: -1000,
    minY: -1000,
    maxX: 1000,
    maxY: 1000,
    zoom: 1.0,
  };
}

/** Follow the bike in physics coordinates (Y-up) */
export function updateCamera(camera: Camera, bikeX: number, bikeY: number): void {
  camera.x = Math.max(camera.minX, Math.min(camera.maxX, bikeX));
  camera.y = Math.max(camera.minY, Math.min(camera.maxY, bikeY));
}

/**
 * Calculate the camera flip interpolation factor.
 * Returns 0.0 (fully right-facing) to 1.0 (fully left-facing).
 */
export function calculateFlipFactor(
  currentTime: number,
  lastFlipTime: number,
  isFlipped: boolean,
  turnTime: number
): number {
  const flipDuration = turnTime + 0.15;
  if (flipDuration <= 0) {
    return isFlipped ? 0.0 : 1.0;
  }

  const elapsed = Math.max(currentTime - lastFlipTime, 0);
  if (isFlipped) {
    if (elapsed > flipDuration) return 0.0;
    return 1.0 - elapsed / flipDuration;
  } else {
    if (elapsed > flipDuration) return 1.0;
    return elapsed / flipDuration;
  }
}