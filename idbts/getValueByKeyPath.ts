export function getValueByKeyPath(obj: unknown, keyPath: string | string[]): unknown {
  if (typeof keyPath === "string") return getValueByField(obj, keyPath);
  return keyPath.map((kp) => getValueByField(obj, kp));
}

export function getValueByField(obj: unknown, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (typeof current != "object" || current == null) return undefined;
    if (!Object.hasOwn(current, part)) return undefined;
    current = (current as any)[part];
  }
  return current;
}
