function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Fill missing settings from the current sample config without replacing any
 * existing values. Arrays are treated as user-configured values and are copied
 * only when the entire setting is missing.
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

    if (isObject(settings[key]) && isObject(defaultValue)) {
      changed = addMissingDefaults(settings[key], defaultValue) || changed;
    }
  }

  return changed;
}
