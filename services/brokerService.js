const { SmartAPI } = require("smartapi-javascript");
const { authenticator } = require("otplib");
const logger = require("../utils/logger");

// Broker session state
let smartApi = null;
let sessionData = null;
let isLoggedIn = false;
let loginTime = null;

// ── Login ────────────────────────────────────────────────────────────────────

async function login() {
  try {
    smartApi = new SmartAPI({
      api_key: process.env.ANGEL_API_KEY,
    });

    const totp = authenticator.generate(process.env.ANGEL_TOTP_SECRET);

    const session = await smartApi.generateSession(
      process.env.ANGEL_CLIENT_CODE,
      process.env.ANGEL_PASSWORD,
      totp
    );

    if (!session || !session.data || !session.data.jwtToken) {
      throw new Error("Login failed — no JWT token in response");
    }

    sessionData = session.data;
    isLoggedIn = true;
    loginTime = new Date().toISOString();

    logger.info("Broker login success", {
      clientCode: process.env.ANGEL_CLIENT_CODE,
      loginTime,
    });

    return {
      success: true,
      clientCode: process.env.ANGEL_CLIENT_CODE,
      loginTime,
    };
  } catch (error) {
    isLoggedIn = false;
    sessionData = null;
    logger.error("Broker login failed", { message: error.message });
    throw error;
  }
}

// ── Session Status ───────────────────────────────────────────────────────────

function getStatus() {
  return {
    isLoggedIn,
    broker: process.env.BROKER || "angel",
    clientCode: process.env.ANGEL_CLIENT_CODE || null,
    loginTime,
  };
}

// ── Ensure logged in (auto-login if needed) ──────────────────────────────────

async function ensureSession() {
  if (!isLoggedIn || !smartApi) {
    await login();
  }
  return smartApi;
}

// ── Place Order ──────────────────────────────────────────────────────────────

async function placeOrder({ symbol, qty, side, orderType, productType, price, triggerPrice }) {
  const api = await ensureSession();

  const variety = "NORMAL";
  const exchange = "NFO";
  const tradingSymbol = symbol;

  // Map friendly names to Angel API values
  const orderSide = side === "BUY" ? "BUY" : "SELL";

  // Angel ordertype: MARKET, LIMIT, STOPLOSS_LIMIT, STOPLOSS_MARKET
  const angelOrderType = mapOrderType(orderType);

  // Angel producttype: INTRADAY, DELIVERY, CARRYFORWARD, BO, CO
  const angelProductType = mapProductType(productType);

  const orderParams = {
    variety,
    tradingsymbol: tradingSymbol,
    symboltoken: "", // Will be resolved if needed
    transactiontype: orderSide,
    exchange,
    ordertype: angelOrderType,
    producttype: angelProductType,
    duration: "DAY",
    price: price || "0",
    squareoff: "0",
    stoploss: "0",
    quantity: String(qty),
    triggerprice: triggerPrice || "0",
  };

  logger.order("Placing order", orderParams);

  try {
    const response = await api.placeOrder(orderParams);

    logger.order("Order response", response);

    if (response && response.data && response.data.orderid) {
      return {
        success: true,
        orderId: response.data.orderid,
        message: response.message || "Order placed",
        raw: response,
      };
    }

    return {
      success: false,
      message: response?.message || "Order placement failed — no orderId",
      raw: response,
    };
  } catch (error) {
    logger.error("Place order failed", { message: error.message, params: orderParams });
    throw error;
  }
}

// ── Exit / Square-off Position ───────────────────────────────────────────────

async function exitOrder({ symbol, qty, side }) {
  // To exit a BUY position, we SELL. To exit a SELL position, we BUY.
  const exitSide = side === "SELL" ? "BUY" : "SELL";

  return placeOrder({
    symbol,
    qty,
    side: exitSide,
    orderType: "MARKET",
    productType: "INTRADAY",
  });
}

// ── Cancel Order ─────────────────────────────────────────────────────────────

async function cancelOrder({ orderId, variety }) {
  const api = await ensureSession();

  const params = {
    variety: variety || "NORMAL",
    orderid: orderId,
  };

  logger.order("Cancelling order", params);

  try {
    const response = await api.cancelOrder(params);
    logger.order("Cancel response", response);
    return {
      success: true,
      message: response?.message || "Order cancelled",
      raw: response,
    };
  } catch (error) {
    logger.error("Cancel order failed", { message: error.message, orderId });
    throw error;
  }
}

// ── Order Book ───────────────────────────────────────────────────────────────

async function getOrderBook() {
  const api = await ensureSession();

  try {
    const response = await api.getOrderBook();

    return {
      success: true,
      orders: response?.data || [],
      raw: response,
    };
  } catch (error) {
    logger.error("Get order book failed", { message: error.message });
    throw error;
  }
}

// ── Single Order Status ──────────────────────────────────────────────────────

async function getOrderStatus(orderId) {
  const api = await ensureSession();

  try {
    const response = await api.getOrderBook();

    const order = (response?.data || []).find(
      (o) => o.orderid === orderId
    );

    if (!order) {
      return { success: false, message: "Order not found" };
    }

    return {
      success: true,
      order,
    };
  } catch (error) {
    logger.error("Get order status failed", { message: error.message, orderId });
    throw error;
  }
}

// ── Positions ────────────────────────────────────────────────────────────────

async function getPositions() {
  const api = await ensureSession();

  try {
    const response = await api.getPosition();

    return {
      success: true,
      positions: response?.data || [],
      raw: response,
    };
  } catch (error) {
    logger.error("Get positions failed", { message: error.message });
    throw error;
  }
}

// ── Trade Book ───────────────────────────────────────────────────────────────

async function getTradeBook() {
  const api = await ensureSession();

  try {
    const response = await api.getTradeBook();

    return {
      success: true,
      trades: response?.data || [],
      raw: response,
    };
  } catch (error) {
    logger.error("Get trade book failed", { message: error.message });
    throw error;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function mapOrderType(type) {
  const map = {
    MARKET: "MARKET",
    LIMIT: "LIMIT",
    STOPLOSS_LIMIT: "STOPLOSS_LIMIT",
    STOPLOSS_MARKET: "STOPLOSS_MARKET",
    SL: "STOPLOSS_LIMIT",
    SLM: "STOPLOSS_MARKET",
  };
  return map[(type || "").toUpperCase()] || "MARKET";
}

function mapProductType(type) {
  const map = {
    INTRADAY: "INTRADAY",
    DELIVERY: "DELIVERY",
    CARRYFORWARD: "CARRYFORWARD",
    CNC: "DELIVERY",
    MIS: "INTRADAY",
    NRML: "CARRYFORWARD",
  };
  return map[(type || "").toUpperCase()] || "INTRADAY";
}

module.exports = {
  login,
  getStatus,
  ensureSession,
  placeOrder,
  exitOrder,
  cancelOrder,
  getOrderBook,
  getOrderStatus,
  getPositions,
  getTradeBook,
};
