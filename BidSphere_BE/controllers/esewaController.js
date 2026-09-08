import { catchAsyncErrors } from "../middlewares/catchAsyncErrors.js";
import ErrorHandler from "../middlewares/error.js";
import { Auction } from "../models/auctionSchema.js";
import { User } from "../models/userSchema.js";
import { PaymentProof } from "../models/commissionProofSchema.js";
import { Commission } from "../models/commissionSchema.js";
import { EsewaTransaction } from "../models/esewaTransactionSchema.js";
import mongoose from "mongoose";
import {
  buildEsewaFormPayload,
  checkEsewaStatus,
  createTransactionUuid,
  decodeEsewaResponse,
  formatEsewaAmount,
  getEsewaConfig,
  parseEsewaAmount,
  verifyResponseSignature,
} from "../utils/esewa.js";

const frontendUrl = () => process.env.FRONTEND_URL || "http://localhost:5173";

const initiatePayment = async ({
  userId,
  purpose,
  amount,
  auctionId,
  successPath,
}) => {
  const { formUrl } = getEsewaConfig();
  const transactionUuid = createTransactionUuid(
    purpose === "auction" ? "BID" : "COM"
  );

  await EsewaTransaction.create({
    userId,
    purpose,
    auctionId,
    amount,
    transactionUuid,
    status: "PENDING",
  });

  const formData = buildEsewaFormPayload({
    amount,
    transactionUuid,
    successUrl: `${frontendUrl()}${successPath}`,
    failureUrl: `${frontendUrl()}/payment/esewa/failure`,
  });

  return { formUrl, formData, transactionUuid };
};

export const initiateAuctionPayment = catchAsyncErrors(async (req, res, next) => {
  const { auctionId } = req.body;
  if (!mongoose.Types.ObjectId.isValid(auctionId)) {
    return next(new ErrorHandler("Invalid auction id.", 400));
  }

  const auction = await Auction.findById(auctionId);
  if (!auction) {
    return next(new ErrorHandler("Auction not found.", 404));
  }

  if (new Date(auction.endTime) > Date.now()) {
    return next(new ErrorHandler("Auction has not ended yet.", 400));
  }

  if (!auction.highestBidder || String(auction.highestBidder) !== String(req.user._id)) {
    return next(new ErrorHandler("Only the winning bidder can pay for this item.", 403));
  }

  if (auction.bidderPaid) {
    return next(new ErrorHandler("This auction has already been paid.", 400));
  }

  if (!auction.currentBid || auction.currentBid <= 0) {
    return next(new ErrorHandler("Invalid auction amount.", 400));
  }

  const { formUrl, formData, transactionUuid } = await initiatePayment({
    userId: req.user._id,
    purpose: "auction",
    amount: auction.currentBid,
    auctionId: auction._id,
    successPath: "/payment/esewa/success",
  });

  res.status(200).json({
    success: true,
    message: "Redirecting to eSewa.",
    paymentUrl: formUrl,
    formData,
    transactionUuid,
  });
});

export const initiateCommissionPayment = catchAsyncErrors(async (req, res, next) => {
  const user = await User.findById(req.user._id);
  if (!user) {
    return next(new ErrorHandler("User not found.", 404));
  }

  if (!user.unpaidCommission || user.unpaidCommission <= 0) {
    return next(new ErrorHandler("You don't have any unpaid commissions.", 400));
  }

  const requestedAmount = req.body.amount
    ? Number(req.body.amount)
    : user.unpaidCommission;

  if (requestedAmount <= 0) {
    return next(new ErrorHandler("Invalid commission amount.", 400));
  }

  if (requestedAmount > user.unpaidCommission) {
    return next(
      new ErrorHandler(
        `Amount exceeds unpaid commission. Pay up to ${user.unpaidCommission}.`,
        403
      )
    );
  }

  const { formUrl, formData, transactionUuid } = await initiatePayment({
    userId: req.user._id,
    purpose: "commission",
    amount: requestedAmount,
    successPath: "/payment/esewa/success",
  });

  res.status(200).json({
    success: true,
    message: "Redirecting to eSewa.",
    paymentUrl: formUrl,
    formData,
    transactionUuid,
  });
});

const settleAuctionPayment = async (transaction, refId, transactionCode) => {
  const auction = await Auction.findById(transaction.auctionId);
  if (!auction) {
    throw new Error("Auction not found for this payment.");
  }
  if (auction.bidderPaid) {
    return auction;
  }

  auction.bidderPaid = true;
  auction.bidderPaymentMethod = "esewa";
  auction.bidderPaymentRef = refId || transactionCode;
  await auction.save();
  return auction;
};

const settleCommissionPayment = async (transaction, refId, transactionCode) => {
  const user = await User.findById(transaction.userId);
  if (!user) {
    throw new Error("User not found for this commission payment.");
  }

  const deduct = Math.min(transaction.amount, user.unpaidCommission);
  user.unpaidCommission = Math.max(0, user.unpaidCommission - deduct);
  await user.save();

  await Commission.create({
    amount: deduct,
    user: user._id,
  });

  await PaymentProof.create({
    userId: user._id,
    paymentMethod: "esewa",
    amount: deduct,
    comment: `Paid via eSewa. Ref: ${refId || transactionCode || transaction.transactionUuid}`,
    status: "Settled",
    transactionUuid: transaction.transactionUuid,
    esewaRefId: refId || transactionCode,
  });

  return user;
};

export const verifyEsewaPayment = catchAsyncErrors(async (req, res, next) => {
  const { data } = req.body;
  if (!data) {
    return next(new ErrorHandler("Missing eSewa response data.", 400));
  }

  let decoded;
  try {
    decoded = decodeEsewaResponse(data);
  } catch (error) {
    return next(new ErrorHandler("Invalid eSewa response payload.", 400));
  }

  const { secretKey, productCode } = getEsewaConfig();
  const signatureValid = verifyResponseSignature(decoded, secretKey);
  const transaction = await EsewaTransaction.findOne({
    transactionUuid: decoded.transaction_uuid,
  });

  if (!transaction) {
    return next(new ErrorHandler("Payment record not found.", 404));
  }

  if (String(transaction.userId) !== String(req.user._id)) {
    return next(new ErrorHandler("You are not allowed to verify this payment.", 403));
  }

  if (transaction.status === "COMPLETE") {
    return res.status(200).json({
      success: true,
      message: "Payment already verified.",
      transaction,
    });
  }

  let statusResult;
  try {
    statusResult = await checkEsewaStatus({
      productCode,
      totalAmount: formatEsewaAmount(transaction.amount),
      transactionUuid: transaction.transactionUuid,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 502));
  }

  const statusAmount = parseEsewaAmount(statusResult.total_amount);
  const decodedAmount = parseEsewaAmount(decoded.total_amount);

  if (statusResult.status !== "COMPLETE") {
    transaction.status =
      statusResult.status === "CANCELED" ? "CANCELED" : "FAILED";
    await transaction.save();
    return next(
      new ErrorHandler(
        `eSewa payment is not complete. Status: ${statusResult.status}`,
        400
      )
    );
  }

  if (Math.abs(statusAmount - transaction.amount) > 0.05) {
    return next(new ErrorHandler("Payment amount does not match our records.", 400));
  }

  if (decoded.status && decoded.status !== "COMPLETE") {
    return next(new ErrorHandler("eSewa callback status is not complete.", 400));
  }

  if (decodedAmount && Math.abs(decodedAmount - transaction.amount) > 0.05) {
    return next(new ErrorHandler("Callback amount does not match our records.", 400));
  }

  if (!signatureValid && !statusResult.ref_id) {
    return next(new ErrorHandler("Could not verify eSewa payment signature.", 400));
  }

  transaction.status = "COMPLETE";
  transaction.esewaRefId = statusResult.ref_id;
  transaction.transactionCode = decoded.transaction_code;
  transaction.completedAt = new Date();
  await transaction.save();

  if (transaction.purpose === "auction") {
    await settleAuctionPayment(
      transaction,
      statusResult.ref_id,
      decoded.transaction_code
    );
  } else {
    await settleCommissionPayment(
      transaction,
      statusResult.ref_id,
      decoded.transaction_code
    );
  }

  const updatedUser = await User.findById(req.user._id);

  res.status(200).json({
    success: true,
    message:
      transaction.purpose === "auction"
        ? "Auction payment verified successfully."
        : "Commission payment verified successfully.",
    transaction,
    user: updatedUser,
  });
});

export const markEsewaFailure = catchAsyncErrors(async (req, res, next) => {
  const { transactionUuid } = req.body;
  if (!transactionUuid) {
    return res.status(200).json({
      success: true,
      message: "Payment was cancelled or failed.",
    });
  }

  const transaction = await EsewaTransaction.findOne({
    transactionUuid,
    userId: req.user._id,
  });

  if (transaction && transaction.status === "PENDING") {
    transaction.status = "FAILED";
    await transaction.save();
  }

  res.status(200).json({
    success: true,
    message: "Payment was cancelled or failed.",
  });
});

export const getWonAuctions = catchAsyncErrors(async (req, res, next) => {
  const auctions = await Auction.find({
    highestBidder: req.user._id,
  }).sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    auctions,
  });
});
