import mongoose from "mongoose";

const paymentProofSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  proof: {
    public_id: {
      type: String,
    },
    url: {
      type: String,
    },
  },
  paymentMethod: {
    type: String,
    enum: ["screenshot", "esewa"],
    default: "screenshot",
  },
  transactionUuid: String,
  esewaRefId: String,
  esewaTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EsewaTransaction",
    unique: true,
    sparse: true,
  },
  uploadedAt: {
    type: Date,
    default: Date.now,
  },
  status: {
    type: String,
    default: "Pending",
    enum: ["Pending", "Approved", "Rejected", "Settled"],
  },
  amount: Number,
  comment: String,
});

export const PaymentProof = mongoose.model("PaymentProof", paymentProofSchema);