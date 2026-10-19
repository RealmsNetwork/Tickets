function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Fill missing settings from the current sample config without replacing any
 * existing values. Arrays of keyed objects receive missing fields only on
 * matching IDs; user-added or removed categories and priority levels are kept.
 */
export function addMissingDefaults(settings, defaults) {
  if (!isObject(settings) || !isObject(defaults)) {
    throw new TypeError('Settings and defaults must be JSON objects.');
  }

  let changed = false;
  for (const [key, defaultValue] of Object.entries(defaults)) {
    if (!Object.hasOwn(settings, key)) {
      settings[key] = structuredClone(defaultValue);
      changed = true;
      continue;
    }

    const currentValue = settings[key];
    if (isObject(currentValue) && isObject(defaultValue)) {
      changed = addMissingDefaults(currentValue, defaultValue) || changed;
      continue;
    }

    if (Array.isArray(currentValue) && Array.isArray(defaultValue)) {
      const keyedDefaults = new Map(
        defaultValue.filter((item) => isObject(item) && item.id !== undefined)
          .map((item) => [String(item.id), item])
      );
      for (const item of currentValue) {
        if (!isObject(item) || item.id === undefined) continue;
        const matchingDefault = keyedDefaults.get(String(item.id));
        if (matchingDefault) changed = addMissingDefaults(item, matchingDefault) || changed;
      }
    }
  }

  return changed;
}
