const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

function loadEnv() {
  const dotenvPath = fs.existsSync(path.join(__dirname, '../../../.env')) 
    ? path.join(__dirname, '../../../.env') 
    : (fs.existsSync(path.join(__dirname, '../../.env')) 
        ? path.join(__dirname, '../../.env') 
        : path.join(__dirname, '../.env'));
  
  const envConfig = dotenv.config({ path: dotenvPath });
  if (envConfig.parsed) {
    if (envConfig.parsed.GEMINI_API_KEY) {
      process.env.GEMINI_API_KEY = envConfig.parsed.GEMINI_API_KEY;
    }
    if (envConfig.parsed.PASSWORD) {
      process.env.PASSWORD = envConfig.parsed.PASSWORD;
    }
    if (envConfig.parsed.USERNAME) {
      process.env.USERNAME = envConfig.parsed.USERNAME;
    }
  }
  return envConfig;
}

module.exports = { loadEnv };
