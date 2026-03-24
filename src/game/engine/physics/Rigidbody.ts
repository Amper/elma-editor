/**
 * Rigidbody interface - ported from physics_init.h
 */
import { Vec2 } from '../core/Vec2';

export interface Rigidbody {
  rotation: number;
  angularVelocity: number;
  radius: number;
  mass: number;
  inertia: number;
  r: Vec2;
  v: Vec2;
}

export function createRigidbody(
  r: Vec2,
  v: Vec2,
  mass: number,
  radius: number,
  inertia: number
): Rigidbody {
  return {
    rotation: 0,
    angularVelocity: 0,
    radius,
    mass,
    inertia,
    r: r.clone(),
    v: v.clone(),
  };
}