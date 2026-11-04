import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // A warning while you type; `npm run lint` passes --max-warnings 0, so
      // CI fails on it. Untyped data at an edge (provider JSON, IPC, a caught
      // error) is `unknown`, narrowed where it is read.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }
      ]
    }
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    // The full set, React Compiler rules included (set-state-in-effect, refs,
    // immutability, purity, ...). What they ask for, in this codebase:
    // - state that follows a prop is adjusted during render (a `prev` state
    //   compared with the prop), or derived outright - not copied in an effect;
    // - a listener bound once reads the latest props through `useEffectEvent`;
    // - an effect that loads data sets state only in the promise's callback
    //   (`read().then(apply)`), never synchronously in its body;
    // - a ref is written in an event or an effect, never during render.
    rules: reactHooks.configs['recommended-latest'].rules,
    languageOptions: { globals: globals.browser }
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node }
  }
)
