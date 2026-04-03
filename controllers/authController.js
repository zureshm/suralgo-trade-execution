const brokerService = require("../services/brokerService");
const logger = require("../utils/logger");

// POST /auth/login
async function login(req, res) {
  try {
    const result = await brokerService.login();
    res.json(result);
  } catch (error) {
    logger.error("Auth login endpoint failed", { message: error.message });
    res.status(500).json({
      success: false,
      message: "Broker login failed: " + error.message,
    });
  }
}

// GET /auth/status
function status(req, res) {
  const result = brokerService.getStatus();
  res.json(result);
}

module.exports = {
  login,
  status,
};
