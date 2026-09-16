import { catchAsyncErrors } from "../middlewares/catchAsyncErrors.js";
import ErrorHandler from "../middlewares/error.js";
import { Auction } from "../models/auctionSchema.js";
import { User } from "../models/userSchema.js";
import { PaymentProof } from "../models/commissionProofSchema.js";
import { Commission } from "../models/commissionSchema.js";
import { EsewaTransaction } from "../models/esewaTransactionSchema.js";
import { applyCommissionOnAuctionPayment } from "./commissionController.js";
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

const formFromTransaction = (transaction) => {
  const { formUrl } = getEsewaConfig();
  const formData = buildEsewaFormPayload({
    amount: transaction.amount,
    transactionUuid: transaction.transactionUuid,
    successUrl: `${frontendUrl()}/payment/esewa/success`,
    failureUrl: `${frontendUrl()}/payment/esewa/failure`,
  });
  return {
    formUrl,
    formData,
    transactionUuid: transaction.transactionUuid,
  };
};

const isAuctionPaid = (auction) =>
  auction.paymentStatus === "paid" || auction.bidderPaid === true;

export const initiateAuctionPayment = catchAsyncErrors(async (req, res, next) => {
  const { auctionId } = req.body;
  if (!mongoose.Types.ObjectId.isValid(auctionId)) {
    return next(new ErrorHandler("Invalid auction id.", 400));
  }

  const auction = await Auction.findById(auctionId);
  if (!auction) {
    return next(new ErrorHandler("Auction not found.", 404));
  }

  const effectiveEnd =
    auction.countdownActive && auction.dynamicEndTime && auction.bids?.length > 0
      ? auction.dynamicEndTime
      : auction.endTime;
  if (new Date(effectiveEnd) > Date.now()) {
    return next(new ErrorHandler("Auction has not ended yet.", 400));
  }

  if (!auction.highestBidder || String(auction.highestBidder) !== String(req.user._id)) {
    return next(new ErrorHandler("Only the winning bidder can pay for this item.", 403));
  }

  if (auction.paymentDeadline && new Date(auction.paymentDeadline) <= new Date()) {
    return next(new ErrorHandler("The 7-day payment deadline has expired.", 400));
  }

  if (!auction.currentBid || auction.currentBid <= 0) {
    return next(new ErrorHandler("Invalid auction amount.", 400));
  }

  const completed = await EsewaTransaction.findOne({
    auctionId: auction._id,
    purpose: "auction",
    status: "COMPLETE",
  });

  if (isAuctionPaid(auction) || completed) {
    if (!isAuctionPaid(auction) && completed) {
      auction.paymentStatus = "paid";
      auction.paymentMethod = "esewa";
      auction.paymentRef = completed.esewaRefId || completed.transactionCode;
      auction.paymentTransactionId = completed._id;
      await auction.save();
    }
    return next(new ErrorHandler("This auction has already been paid.", 400));
  }

  // Cancel any prior PENDING transactions for this auction to guarantee a fresh UUID
  await EsewaTransaction.updateMany(
    {
      auctionId: auction._id,
      purpose: "auction",
      status: "PENDING",
    },
    { status: "CANCELED" }
  );

  const transaction = await EsewaTransaction.create({
    userId: req.user._id,
    purpose: "auction",
    auctionId: auction._id,
    amount: auction.currentBid,
    transactionUuid: createTransactionUuid("BID"),
    status: "PENDING",
  });

  auction.paymentStatus = "pending";
  auction.paymentMethod = "esewa";
  auction.paymentTransactionId = transaction._id;
  await auction.save();

  const { formUrl, formData, transactionUuid } = formFromTransaction(transaction);

  res.status(200).json({
    success: true,
    message: "Redirecting to eSewa.",
    paymentUrl: formUrl,
    formData,
    transactionUuid,
    paymentStatus: auction.paymentStatus,
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

  const pendingProof = await PaymentProof.findOne({
    userId: user._id,
    status: { $in: ["Pending", "Approved"] },
  });
  if (pendingProof) {
    return next(
      new ErrorHandler(
        "You already have a commission payment in review. Wait until it is settled.",
        400
      )
    );
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

  // Cancel any prior PENDING transactions for this user to guarantee a fresh UUID
  await EsewaTransaction.updateMany(
    {
      userId: user._id,
      purpose: "commission",
      status: "PENDING",
    },
    { status: "CANCELED" }
  );

  const transaction = await EsewaTransaction.create({
    userId: user._id,
    purpose: "commission",
    amount: requestedAmount,
    transactionUuid: createTransactionUuid("COM"),
    status: "PENDING",
  });

  const { formUrl, formData, transactionUuid } = formFromTransaction(transaction);

  res.status(200).json({
    success: true,
    message: "Redirecting to eSewa.",
    paymentUrl: formUrl,
    formData,
    transactionUuid,
    paymentStatus: "pending",
  });
});

const settleAuctionPayment = async (transaction, refId, transactionCode) => {
  const updated = await Auction.findOneAndUpdate(
    {
      _id: transaction.auctionId,
      paymentStatus: { $ne: "paid" },
    },
    {
      paymentStatus: "paid",
      paymentMethod: "esewa",
      paymentRef: refId || transactionCode,
      paymentTransactionId: transaction._id,
    },
    { new: true }
  );

  const auction = updated || (await Auction.findById(transaction.auctionId));
  if (auction && (auction.paymentStatus === "paid" || auction.bidderPaid) && !auction.commissionCalculated) {
    await applyCommissionOnAuctionPayment(auction._id);
  }

  return auction;
};

const settleCommissionPayment = async (transaction, refId, transactionCode) => {
  const user = await User.findById(transaction.userId);
  if (!user) {
    throw new Error("User not found for this commission payment.");
  }

  let proof = await PaymentProof.findOne({
    $or: [
      { esewaTransactionId: transaction._id },
      { transactionUuid: transaction.transactionUuid },
    ],
  });

  const alreadyCommission = await Commission.findOne({
    esewaTransactionId: transaction._id,
  });

  if (proof && proof.status === "Settled" && alreadyCommission) {
    return user;
  }

  const deduct = Math.min(transaction.amount, user.unpaidCommission);
  let updatedUser = user;
  if (deduct > 0) {
    updatedUser = await User.findByIdAndUpdate(
      user._id,
      {
        $inc: {
          unpaidCommission: -deduct,
        },
      },
      { new: true }
    );
  }

  if (!proof) {
    proof = await PaymentProof.create({
      userId: user._id,
      paymentMethod: "esewa",
      amount: transaction.amount,
      comment: `Paid via eSewa. Ref: ${refId || transactionCode || transaction.transactionUuid}`,
      status: "Settled",
      transactionUuid: transaction.transactionUuid,
      esewaRefId: refId || transactionCode,
      esewaTransactionId: transaction._id,
    });
  } else {
    proof.status = "Settled";
    proof.amount = transaction.amount;
    if (!proof.esewaRefId) {
      proof.esewaRefId = refId || transactionCode;
    }
    if (!proof.esewaTransactionId) {
      proof.esewaTransactionId = transaction._id;
    }
    await proof.save();
  }

  if (!alreadyCommission && (deduct > 0 || transaction.amount > 0)) {
    await Commission.create({
      amount: deduct > 0 ? deduct : transaction.amount,
      user: user._id,
      esewaTransactionId: transaction._id,
    });
  }

  return updatedUser;
};

export const verifyEsewaPayment = catchAsyncErrors(async (req, res, next) => {
  const { data } = req.body;
  if (!data) {
    return next(new ErrorHandler("Missing eSewa response data.", 400));
  }

  let updatedUser = req.user;

  let decoded;
  try {
    decoded = decodeEsewaResponse(data);
  } catch (error) {
    return next(new ErrorHandler("Invalid eSewa response payload.", 400));
  }

  const { secretKey, productCode } = getEsewaConfig();
  const signatureValid = verifyResponseSignature(decoded, secretKey);
  const existing = await EsewaTransaction.findOne({
    transactionUuid: decoded.transaction_uuid,
  });

  if (!existing) {
    return next(new ErrorHandler("Payment record not found.", 404));
  }

  if (String(existing.userId) !== String(req.user._id)) {
    return next(new ErrorHandler("You are not allowed to verify this payment.", 403));
  }

  if (existing.status === "COMPLETE") {
    if (existing.purpose === "auction") {
      await settleAuctionPayment(
        existing,
        existing.esewaRefId,
        existing.transactionCode
      );
    } else {
      updatedUser = await settleCommissionPayment(
        existing,
        existing.esewaRefId,
        existing.transactionCode
      );
    }
    return res.status(200).json({
      success: true,
      message: "Payment already verified.",
      transaction: existing,
      paymentStatus: "paid",
      user: updatedUser,
    });
  }

  let statusResult;
  try {
    statusResult = await checkEsewaStatus({
      productCode,
      totalAmount: formatEsewaAmount(existing.amount),
      transactionUuid: existing.transactionUuid,
    });
  } catch (error) {
    return next(new ErrorHandler(error.message, 502));
  }

  const statusAmount = parseEsewaAmount(statusResult.total_amount);
  const decodedAmount = parseEsewaAmount(decoded.total_amount);

  if (statusResult.status !== "COMPLETE") {
    const failedStatus =
      statusResult.status === "CANCELED" ? "CANCELED" : "FAILED";
    existing.status = failedStatus;
    await existing.save();
    if (existing.purpose === "auction") {
      await Auction.findOneAndUpdate(
        { _id: existing.auctionId, paymentStatus: "pending" },
        { paymentStatus: "unpaid", paymentTransactionId: null }
      );
    }
    return next(
      new ErrorHandler(
        `eSewa payment is not complete. Status: ${statusResult.status}`,
        400
      )
    );
  }

  if (Math.abs(statusAmount - existing.amount) > 0.05) {
    return next(new ErrorHandler("Payment amount does not match our records.", 400));
  }

  if (decoded.status && decoded.status !== "COMPLETE") {
    return next(new ErrorHandler("eSewa callback status is not complete.", 400));
  }

  if (decodedAmount && Math.abs(decodedAmount - existing.amount) > 0.05) {
    return next(new ErrorHandler("Callback amount does not match our records.", 400));
  }

  if (!signatureValid && !statusResult.ref_id) {
    return next(new ErrorHandler("Could not verify eSewa payment signature.", 400));
  }

  const transaction = await EsewaTransaction.findOneAndUpdate(
    { _id: existing._id, status: { $in: ["PENDING", "CANCELED"] } },
    {
      status: "COMPLETE",
      esewaRefId: statusResult.ref_id,
      transactionCode: decoded.transaction_code,
      completedAt: new Date(),
    },
    { new: true }
  );

  if (!transaction) {
    const alreadyComplete = await EsewaTransaction.findById(existing._id);
    if (alreadyComplete.purpose === "auction") {
      await settleAuctionPayment(
        alreadyComplete,
        alreadyComplete.esewaRefId,
        alreadyComplete.transactionCode
      );
    } else {
      updatedUser = await settleCommissionPayment(
        alreadyComplete,
        alreadyComplete.esewaRefId,
        alreadyComplete.transactionCode
      );
    }
    return res.status(200).json({
      success: true,
      message: "Payment already verified.",
      transaction: alreadyComplete,
      paymentStatus: "paid",
      user: updatedUser,
    });
  }

  if (transaction.purpose === "auction") {
    await settleAuctionPayment(
      transaction,
      statusResult.ref_id,
      decoded.transaction_code
    );
  } else {
    updatedUser = await settleCommissionPayment(
      transaction,
      statusResult.ref_id,
      decoded.transaction_code
    );
  }

  res.status(200).json({
    success: true,
    message:
      transaction.purpose === "auction"
        ? "Auction payment verified successfully."
        : "Commission payment verified successfully.",
    transaction,
    paymentStatus: "paid",
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
    if (transaction.purpose === "auction") {
      await Auction.findOneAndUpdate(
        { _id: transaction.auctionId, paymentStatus: "pending" },
        { paymentStatus: "unpaid", paymentTransactionId: null }
      );
    }
  }

  res.status(200).json({
    success: true,
    message: "Payment was cancelled or failed.",
  });
});

export const getWonAuctions = catchAsyncErrors(async (req, res, next) => {
  const candidateAuctions = await Auction.find({
    $or: [
      { highestBidder: req.user._id },
      { "bids.userId": req.user._id },
    ],
  }).sort({ createdAt: -1 });

  const auctions = [];
  for (const auction of candidateAuctions) {
    const effectiveEnd =
      auction.countdownActive && auction.dynamicEndTime && auction.bids?.length > 0
        ? auction.dynamicEndTime
        : auction.endTime;

    if (!effectiveEnd || new Date(effectiveEnd) > new Date()) continue;

    const highestBid = (auction.bids || []).reduce(
      (current, bid) => (!current || bid.amount > current.amount ? bid : current),
      null
    );
    const winnerId = auction.highestBidder || highestBid?.userId;

    if (winnerId && String(winnerId) === String(req.user._id)) {
      if (!auction.highestBidder) {
        auction.highestBidder = winnerId;
        await auction.save();
      }
      auctions.push(auction);
    }
  }

  const ids = auctions.map((auction) => auction._id);
  const transactions = await EsewaTransaction.find({
    auctionId: { $in: ids },
    purpose: "auction",
    status: { $in: ["PENDING", "COMPLETE"] },
  });

  const byAuction = new Map(
    transactions.map((txn) => [String(txn.auctionId), txn])
  );

  for (const auction of auctions) {
    const txn = byAuction.get(String(auction._id));
    if (txn?.status === "COMPLETE" && auction.paymentStatus !== "paid") {
      auction.paymentStatus = "paid";
      auction.paymentMethod = "esewa";
      auction.paymentRef = txn.esewaRefId || txn.transactionCode;
      auction.paymentTransactionId = txn._id;
      await auction.save();
      await applyCommissionOnAuctionPayment(auction._id);
    } else if (auction.paymentStatus === "paid" && !auction.commissionCalculated) {
      await applyCommissionOnAuctionPayment(auction._id);
    } else if (txn?.status === "PENDING" && auction.paymentStatus !== "paid") {
      if (auction.paymentStatus !== "pending") {
        auction.paymentStatus = "pending";
        auction.paymentMethod = "esewa";
        auction.paymentTransactionId = txn._id;
        await auction.save();
      }
    }
  }

  res.status(200).json({
    success: true,
    auctions,
  });
});

// Payment records are scoped to the authenticated bidder so a bidder can
// review their own proof/reference without seeing anyone else's payments.
export const getBidderPaymentDetails = catchAsyncErrors(async (req, res) => {
  const payments = await EsewaTransaction.find({
    userId: req.user._id,
    purpose: "auction",
  })
    .populate("auctionId", "title image currentBid paymentStatus paymentMethod")
    .sort({ createdAt: -1 });

  res.status(200).json({ success: true, payments });
});
