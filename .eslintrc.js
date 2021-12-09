module.exports = {
    extends: [
        '@jitsi/eslint-config'
    ],
    parserOptions: {
        requireConfigFile: false
    },
    globals: {
        'process': true,
        '__dirname': true
    }
};
