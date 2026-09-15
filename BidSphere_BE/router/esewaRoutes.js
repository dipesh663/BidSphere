import express from "express";
import { isAuthenticated, isAuthorized } from "../middlewares/auth.js";
import {
  getWonAuctions,
  getBidderPaymentDetails,
  initiateAuctionPayment,
  initiateCommissionPayment,
  markEsewaFailure,
  verifyEsewaPayment,
} from "../controllers/esewaController.js";

const router = express.Router();

router.post(
  "/initiate/auction",
  isAuthenticated,
  isAuthorized("Bidder"),
  initiateAuctionPayment
);

router.post(
  "/initiate/commission",
  isAuthenticated,
  isAuthorized("Auctioneer"),
  initiateCommissionPayment
);

router.post("/verify", isAuthenticated, verifyEsewaPayment);
router.post("/failure", isAuthenticated, markEsewaFailure);
router.get(
  "/won-auctions",
  isAuthenticated,
  isAuthorized("Bidder"),
  getWonAuctions
);
router.get(
  "/payment-details",
  isAuthenticated,
  isAuthorized("Bidder"),
  getBidderPaymentDetails
);

export default router;
