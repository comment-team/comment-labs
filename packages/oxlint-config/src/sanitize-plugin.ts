export interface SanitizableRule {
  meta?: { defaultOptions?: unknown[] } | null
}

export interface SanitizablePlugin {
  rules?: Record<string, SanitizableRule | undefined>
}

function truncateDefaultOptions(rule: SanitizableRule | undefined): SanitizableRule | undefined {
  const defaultOptions = rule?.meta?.defaultOptions

  if (!Array.isArray(defaultOptions)) {
    return rule
  }

  const index = defaultOptions.findIndex(option => option === null || option === undefined)

  if (index === -1) {
    return rule
  }

  return { ...rule, meta: { ...rule?.meta, defaultOptions: defaultOptions.slice(0, index) } }
}

/**
 * Wraps an ESLint plugin so oxlint can register it regardless of which ESLint
 * version the consumer resolves. Some plugins derive `meta.defaultOptions` from
 * a peer ESLint core rule at runtime (e.g. eslint-plugin-unicorn's
 * `logical-assignment-operators` reads `baseRule.meta.defaultOptions?.[0]`),
 * which yields `[undefined]` — serialized as `[null]` — when that core rule has
 * no `defaultOptions` (ESLint 9 and older). oxlint validates rule defaults
 * against the rule schema at plugin registration and refuses to load the whole
 * plugin over it. Each rule's `defaultOptions` is truncated at the first
 * nullish entry, preserving the valid prefix; rules without nullish entries
 * are kept as-is, by reference.
 */
export function sanitizePlugin(plugin: unknown): SanitizablePlugin {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const { rules } = plugin as SanitizablePlugin

  if (rules === undefined) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return plugin as SanitizablePlugin
  }

  const sanitizedRules = Object.fromEntries(
    Object.entries(rules).map(([ name, rule ]) => [ name, truncateDefaultOptions(rule) ])
  )

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { ...(plugin as SanitizablePlugin), rules: sanitizedRules }
}
