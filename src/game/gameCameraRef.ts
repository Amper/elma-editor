/**
 * Module-level mutable ref for the game camera position.
 * GameOverlay writes to it each frame; Minimap reads from it in its rAF loop.
 */
export const gameCameraRef = { x: 0, y: 0, active: false };
