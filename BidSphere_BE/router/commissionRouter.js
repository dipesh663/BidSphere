import express from "express";
import { proofOfCommission, getMyCommissionPaymentDetails } from "../controllers/commissionController.js";
import { isAuthenticated, isAuthorized } from "../middlewares/auth.js";

const router = express.Router();

router.post(
  "/proof",
  isAuthenticated,
  isAuthorized("Auctioneer"),
  proofOfCommission
);
router.get(
  "/payment-details",
  isAuthenticated,
  isAuthorized("Auctioneer"),
  getMyCommissionPaymentDetails
);

export default router;
