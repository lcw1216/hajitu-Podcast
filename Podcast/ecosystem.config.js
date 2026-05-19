module.exports = {
  apps: [{
    name: 'acm-groupwork',
    script: 'server.js',
    cwd: __dirname,
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      SESSION_SECRET: 'acm-groupwork-secret-key-2024'
    },
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    max_memory_restart: '512M',
    autorestart: true,
    watch: false,
    max_restarts: 10,
    restart_delay: 3000,
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true
  }]
};
