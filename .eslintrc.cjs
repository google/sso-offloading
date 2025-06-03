module.exports = {
    root: true, 
    parser: '@typescript-eslint/parser', 
    plugins: ['@typescript-eslint/eslint-plugin'],
    extends: [
        'eslint:recommended', 
        'plugin:@typescript-eslint/recommended', 
        'plugin:prettier/recommended',
    ],
    env: {
        browser: true, 
        node: true,    
        es2021: true,  
    },
    ignorePatterns: [
        'node_modules',
        'dist',
        '**/dist',
        '.eslintrc.cjs',
        'vite.config.ts',
    ],
    rules: {
        '@typescript-eslint/no-unused-vars': 'warn', 
    },
  };