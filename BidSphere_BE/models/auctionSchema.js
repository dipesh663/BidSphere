import mongoose from 'mongoose';

const auctionSchema = new mongoose.Schema({
    title: String,
    description: String,
    startingBid: Number,
    category: String,
    condition:{
        type: String,
        enum: ['New', 'Used'],
    },
    currentBid: {
        type: Number,
        default: 0
    },
    startTime: String,
    endTime: String,

    image: {
        public_id: {
            type: String,
            required: true
        },
        url: {
            type: String,
            required: true
        }
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    bids: [
        {
            userId:{
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Bid',
            },
            userName: String,
            amount: Number,
            profileImage: String
        }
    ],

    highestBidder: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
    },

    commissionCalculated: {
        type: Boolean,
        default: false
    },
    endedHandled: {
        type: Boolean,
        default: false
    },
    paymentStatus: {
        type: String,
        enum: ["unpaid", "pending", "paid"],
        default: "unpaid",
    },
    paymentMethod: {
        type: String,
        enum: ["none", "esewa", "manual"],
        default: "none",
    },
    paymentRef: String,
    paymentTransactionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "EsewaTransaction",
    },

    createdAt: {
        type: Date,
        default: Date.now
    },
});

auctionSchema.set("toJSON", {
  virtuals: true,
  transform(_doc, ret) {
    if (!ret.paymentStatus) {
      ret.paymentStatus = ret.bidderPaid ? "paid" : "unpaid";
    }
    ret.bidderPaid = ret.paymentStatus === "paid";
    ret.bidderPaymentMethod =
      ret.paymentMethod && ret.paymentMethod !== "none"
        ? ret.paymentMethod
        : ret.bidderPaymentMethod || "unpaid";
    return ret;
  },
});

export const Auction = mongoose.model('Auction', auctionSchema);