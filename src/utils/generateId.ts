let counter = 0;

/** Generate a unique ID for polygons and objects. */
export function generateId(): string {
  return `${Date.now().toString(36)}-${(counter++).toString(36)}`;
}