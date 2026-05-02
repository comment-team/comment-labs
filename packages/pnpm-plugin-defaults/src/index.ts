const day = 24 * 60

const hooks = {
  updateConfig: (config: object) => {
    Object.assign(config, {
      allowBuilds: {
        '@apollo/protobufjs': false,
        '@firebase/util': false,
        '@neoaren/comet': false,
        '@parcel/watcher': false,
        '@prisma/client': false,
        '@prisma/engines': false,
        '@sentry/cli': false,
        '@shopify/react-native-skia': true,
        '@tailwindcss/oxide': false,
        'core-js': false,
        'core-js-pure': false,
        'dtrace-provider': false,
        esbuild: false,
        'json-editor-vue': false,
        'msgpackr-extract': false,
        prisma: false,
        protobufjs: false,
        sharp: true,
        'unrs-resolver': false,
        'vue-demi': false,
        workerd: false
      },
      blockExoticSubdeps: true,
      dedupePeerDependents: true,
      enablePrePostScripts: true,
      hoist: false,
      ignorePatchFailures: false,
      ignoredOptionalDependencies: [
        '@prisma/*',
        'prisma'
      ],
      minimumReleaseAge: 3 * day,
      optimisticRepeatInstall: true,
      resolvePeersFromWorkspaceRoot: false,
      saveExact: true,
      shellEmulator: true,
      shamefullyHoist: false,
      strictPeerDependencies: true,
      trustPolicy: 'no-downgrade',
      verifyDepsBeforeRun: 'warn'
    })

    return config
  }
}

export default { hooks }
