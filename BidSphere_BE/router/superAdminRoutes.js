import express from "express";
import { isAuthenticated, isAuthorized } from "../middlewares/auth.js";
import {
  deleteAuctionItem,
  deletePaymentProof,
  fetchAllUsers,
  getAllPaymentProofs,
  getPaymentProofDetail,
  monthlyRevenue,
  updateProofStatus,
} from "../controllers/superAdminController.js";

const router = express.Router();

router.delete(
  "/auctionitem/delete/:id",
  isAuthenticated,
  isAuthorized("SuperAdmin"),
  deleteAuctionItem
);

router.get(
  "/paymentproofs/getall",
  isAuthenticated,
  isAuthorized("SuperAdmin"),
  getAllPaymentProofs
);

router.get(
  "/paymentproof/:id",
  isAuthenticated,
  isAuthorized("SuperAdmin"),
  getPaymentProofDetail
);

router.put(
  "/paymentproof/status/update/:id",
  isAuthenticated,
  isAuthorized("SuperAdmin"),
  updateProofStatus
);

router.delete(
  "/paymentproof/delete/:id",
  isAuthenticated,
  isAuthorized("SuperAdmin"),
  deletePaymentProof
);

router.get(
  "/users/getall",
  isAuthenticated,
  isAuthorized("SuperAdmin"),
  fetchAllUsers
);

router.get(
  "/monthlyincome",
  isAuthenticated,
  isAuthorized("SuperAdmin"),
  monthlyRevenue
);

export default router;