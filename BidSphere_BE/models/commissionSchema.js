import mongoose from "mongoose";

const commissionSchema = new mongoose.Schema({
  amount: Number,
  user: mongoose.Schema.Types.ObjectId,
   esewaTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "EsewaTransaction",
    sparse: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const Commission = mongoose.model("Commission", commissionSchema);
