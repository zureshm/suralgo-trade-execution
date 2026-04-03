const express = require("express");
const router = express.Router();
const authController = require("../controllers/authController");

// POST /auth/login — Login to broker
router.post("/login", authController.login);

// GET /auth/status — Check broker session status
router.get("/status", authController.status);

module.exports = router;
