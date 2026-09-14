import { catchAsyncErrors } from "../middlewares/catchAsyncErrors.js";
import ErrorHandler from "../middlewares/error.js";
import { PaymentProof } from "../models/commissionProofSchema.js";
import { User } from "../models/userSchema.js";
import { Auction } from "../models/auctionSchema.js";
import { EsewaTransaction } from "../models/esewaTransactionSchema.js";
import { v2 as cloudinary } from "cloudinary";
import mongoose from "mongoose";

export const calculateCommission = async (auctionId) => {
  if (!mongoose.Types.ObjectId.isValid(auctionId)) {
    throw new Error("Invalid Auction Id format.");
  }
  const auction = await Auction.findById(auctionId);
  if (!auction) {
    throw new Error("Auction not found.");
  }
  const commissionRate = 0.05;
  const commission = (auction.currentBid || 0) * commissionRate;
  return commission;
};

export const applyCommissionOnAuctionPayment = async (auctionId) => {
  if (!mongoose.Types.ObjectId.isValid(auctionId)) {
    return null;
  }
  const auction = await Auction.findById(auctionId);
  if (!auction) return null;

  if (auction.commissionCalculated) {
    return auction;
  }

  const commissionAmount = await calculateCommission(auction._id);
  auction.commissionCalculated = true;
  await auction.save();

  if (auction.createdBy) {
    await User.findByIdAndUpdate(
      auction.createdBy,
      {
        $inc: {
          unpaidCommission: commissionAmount,
        },
      },
      { new: true }
    );
  }

  if (auction.highestBidder && auction.currentBid > 0) {
    await User.findByIdAndUpdate(
      auction.highestBidder,
      {
        $inc: {
          moneySpent: auction.currentBid,
        },
      },
      { new: true }
    );
  }

  console.log(`Commission of ${commissionAmount} applied for auction ${auction._id} upon payment.`);
  return auction;
};

export const proofOfCommission = catchAsyncErrors(async (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return next(new ErrorHandler("Payment Proof Screenshot required.", 400));
  }
  const { proof } = req.files;
  const { amount, comment } = req.body;
  const user = await User.findById(req.user._id);

  if (!amount || !comment) {
    return next(
      new ErrorHandler("Ammount & comment are required fields.", 400)
    );
  }

  if (user.unpaidCommission === 0) {
    return res.status(200).json({
      success: true,
      message: "You don't have any unpaid commissions.",
    });
  }

  const pendingEsewa = await EsewaTransaction.findOne({
    userId: user._id,
    purpose: "commission",
    status: "PENDING",
  });
  if (pendingEsewa) {
    return next(
      new ErrorHandler(
        "An eSewa commission payment is already pending for this account.",
        400
      )
    );
  }

  const pendingProof = await PaymentProof.findOne({
    userId: user._id,
    status: { $in: ["Pending", "Approved"] },
  });
  if (pendingProof) {
    return next(
      new ErrorHandler(
        "You already have a commission payment in review.",
        400
      )
    );
  }

  if (user.unpaidCommission < amount) {
    return next(
      new ErrorHandler(
        `The amount exceeds your unpaid commission balance. Please enter an amount up to ${user.unpaidCommission}`,
        403
      )
    );
  }

  const allowedFormats = ["image/png", "image/jpeg", "image/webp"];
  if (!allowedFormats.includes(proof.mimetype)) {
    return next(new ErrorHandler("ScreenShot format not supported.", 400));
  }

  const cloudinaryResponse = await cloudinary.uploader.upload(
    proof.tempFilePath,
    {
      folder: "MERN_AUCTION_PAYMENT_PROOFS",
    }
  );
  if (!cloudinaryResponse || cloudinaryResponse.error) {
    console.error(
      "Cloudinary error:",
      cloudinaryResponse.error || "Unknown cloudinary error."
    );
    return next(new ErrorHandler("Failed to upload payment proof.", 500));
  }
  const commissionProof = await PaymentProof.create({
    userId: req.user._id,
    paymentMethod: "screenshot",
    proof: {
      public_id: cloudinaryResponse.public_id,
      url: cloudinaryResponse.secure_url,
    },
    amount,
    comment,
  });
  res.status(201).json({
    success: true,
    message:
      "Your proof has been submitted successfully. We will review it and responed to you within 24 hours.",
    commissionProof,
  });
});