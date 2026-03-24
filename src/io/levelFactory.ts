import { Level } from 'elmajs';

/**
 * Create a new empty level with a default rectangular room and start/exit objects.
 * The elmajs Level constructor provides this out of the box.
 */
export function createNewLevel(): Level {
  return new Level();
}
