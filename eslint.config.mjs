import { createConfigForNuxt } from '@nuxt/eslint-config/flat'

export default createConfigForNuxt({
  rules: {
    // Global
    semi: ['error', 'never'],
    quotes: ['error', 'single'],
    'quote-props': ['error', 'as-needed'],
    // Typescript
    '@typescript-eslint/indent': ['error', 2],
  }
})
