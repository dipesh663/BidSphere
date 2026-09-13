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

esewaTransactionSchema.index(
  { auctionId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      purpose: "auction",
      status: { $in: ["PENDING", "COMPLETE"] },
    },
  }
);

esewaTransactionSchema.index(
  { userId: 1, purpose: 1 },
  {
    unique: true,
    partialFilterExpression: {
      purpose: "commission",
      status: "PENDING",
    },
  }
);

export const EsewaTransaction = mongoose.model(
  "EsewaTransaction",
  esewaTransactionSchema
);
