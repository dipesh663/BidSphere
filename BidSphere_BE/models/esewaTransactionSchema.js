import mongoose from "mongoose";

const esewaTransactionSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  purpose: {
    type: String,
    enum: ["auction", "commission"],
    required: true,
  },
  auctionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Auction",
  },
  amount: {
    type: Number,
    required: true,
  },
  transactionUuid: {
    type: String,
    required: true,
    unique: true,
  },
  status: {
    type: String,
    enum: ["PENDING", "COMPLETE", "FAILED", "CANCELED"],
    default: "PENDING",
  },
  esewaRefId: String,
  transactionCode: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
  completedAt: Date,
});

export const EsewaTransaction = mongoose.model(
  "EsewaTransaction",
  esewaTransactionSchema
);
