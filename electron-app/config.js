// Configuration for Electron app
module.exports = {
  servers: {
    api: {
      port: 3701,
      host: 'http://localhost:3701',
      healthEndpoint: '/health'
    },
    web: {
      port: 3700,
      host: 'http://localhost:3700',
      healthEndpoint: '/'
    },
    // Set to false to skip starting bundled servers (for remote connections)
    // Set to true to always start bundled servers
    // If null/undefined, auto-detects based on host (localhost = start servers)
    startBundledServers: null,
    startupTimeout: 15000,
    healthPollInterval: 500
  },

  window: {
    width: 1400,
    height: 1024,
    title: 'Client Time Tracker'
  }
};
