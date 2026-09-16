import mongoose from "mongoose";
import { catchAsyncErrors } from "../middlewares/catchAsyncErrors.js";
import ErrorHandler from "../middlewares/error.js";
import { Commission } from "../models/commissionSchema.js";
import { User } from "../models/userSchema.js";
import { Auction } from "../models/auctionSchema.js";
import { PaymentProof } from "../models/commissionProofSchema.js";
import { sendEmail } from "../utils/sendEmail.js";

const normalizeModerationReason = (reason) => {
  const cleanReason = String(reason || "").trim();
  return cleanReason || "No reason was provided by the administrator.";
};

const notifyUserAboutModeration = async ({ user, action, reason }) => {
  if (!user || !user.email) return;

  const subject =
    action === "auction"
      ? "Auction Removal Notice"
      : "Account Moderation Notice";

  const detailText =
    action === "auction"
      ? `Your auction was removed by the platform admin for the following reason:\n\n${reason}\n\nIf you believe this was a mistake, please contact support.`
      : `Your account was ${action === "block" ? "blocked" : "removed"} by the platform admin for the following reason:\n\n${reason}\n\nIf you believe this was a mistake, please contact support.`;

  try {
    await sendEmail({
      email: user.email,
      subject,
      message: detailText,
    });
  } catch (error) {
    console.error("Moderation email notification failed:", error.message);
  }
};

const notifyAuctionParticipants = async (auctionItem, moderationReason) => {
  if (!auctionItem) return;

  const uniqueBidderIds = [
    ...(auctionItem.bids || []).map((bid) => bid.userId).filter(Boolean),
    auctionItem.highestBidder ? auctionItem.highestBidder : null,
  ]
    .filter((value) => value)
    .map((value) => String(value));

  const uniqueUserIds = [...new Set(uniqueBidderIds)];
  if (uniqueUserIds.length === 0) return;

  const users = await User.find({ _id: { $in: uniqueUserIds } }).select("email userName role");

  for (const user of users) {
    await notifyUserAboutModeration({
      user,
      action: "auction",
      reason: moderationReason,
    });
  }
};

export const deleteAuctionItem = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  const { reason } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorHandler("Invalid Id format.", 400));
  }

  const auctionItem = await Auction.findById(id);
  if (!auctionItem) {
    return next(new ErrorHandler("Auction not found.", 404));
  }

  const moderationReason = normalizeModerationReason(reason);

  auctionItem.moderationHistory = auctionItem.moderationHistory || [];
  auctionItem.moderationHistory.push({
    action: "delete",
    reason: moderationReason,
  });

  if (auctionItem.createdBy) {
    const user = await User.findById(auctionItem.createdBy);
    if (user) {
      await notifyUserAboutModeration({
        user,
        action: "auction",
        reason: moderationReason,
      });
    }
  }

  await notifyAuctionParticipants(auctionItem, moderationReason);

  await auctionItem.save();
  await auctionItem.deleteOne();
  res.status(200).json({
    success: true,
    message: "Auction item deleted successfully.",
  });
});

export const getAllPaymentProofs = catchAsyncErrors(async (req, res, next) => {
  let paymentProofs = await PaymentProof.find();
  res.status(200).json({
    success: true,
    paymentProofs,
  });
});

export const getPaymentProofDetail = catchAsyncErrors(
  async (req, res, next) => {
    const { id } = req.params;
    const paymentProofDetail = await PaymentProof.findById(id);
    res.status(200).json({
      success: true,
      paymentProofDetail,
    });
  }
);

export const updateProofStatus = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  const { amount, status } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorHandler("Invalid ID format.", 400));
  }
  let proof = await PaymentProof.findById(id);
  if (!proof) {
    return next(new ErrorHandler("Payment proof not found.", 404));
  }
  proof = await PaymentProof.findByIdAndUpdate(
    id,
    { status, amount },
    {
      new: true,
      runValidators: true,
      useFindAndModify: false,
    }
  );
  res.status(200).json({
    success: true,
    message: "Payment proof amount and status updated.",
    proof,
  });
});

export const deletePaymentProof = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  const proof = await PaymentProof.findById(id);
  if (!proof) {
    return next(new ErrorHandler("Payment proof not found.", 404));
  }
  await proof.deleteOne();
  res.status(200).json({
    success: true,
    message: "Payment proof deleted.",
  });
});

export const fetchAllUsers = catchAsyncErrors(async (req, res, next) => {
  const users = await User.aggregate([
    {
      $group: {
        _id: {
          month: { $month: "$createdAt" },
          year: { $year: "$createdAt" },
          role: "$role",
        },
        count: { $sum: 1 },
      },
    },
    {
      $project: {
        month: "$_id.month",
        year: "$_id.year",
        role: "$_id.role",
        count: 1,
        _id: 0,
      },
    },
    {
      $sort: { year: 1, month: 1 },
    },
  ]);

  const bidders = users.filter((user) => user.role === "Bidder");
  const auctioneers = users.filter((user) => user.role === "Auctioneer");

  const tranformDataToMonthlyArray = (data, totalMonths = 12) => {
    const result = Array(totalMonths).fill(0);

    data.forEach((item) => {
      result[item.month - 1] = item.count;
    });

    return result;
  };

  const biddersArray = tranformDataToMonthlyArray(bidders);
  const auctioneersArray = tranformDataToMonthlyArray(auctioneers);

  res.status(200).json({
    success: true,
    biddersArray,
    auctioneersArray,
  });
});

export const getAllUsersForAdmin = catchAsyncErrors(async (req, res, next) => {
  const users = await User.find({}).select("-password").sort({ createdAt: -1 });

  res.status(200).json({
    success: true,
    users,
  });
});

export const getUserDetailForAdmin = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorHandler("Invalid user ID format.", 400));
  }

  const user = await User.findById(id).select("-password");

  if (!user) {
    return next(new ErrorHandler("User not found.", 404));
  }

  res.status(200).json({
    success: true,
    user,
  });
});

export const moderateUserAccount = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  const { action, reason } = req.body || {};

  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorHandler("Invalid user ID format.", 400));
  }

  const normalizedAction = String(action || "").toLowerCase();
  if (!["block", "delete"].includes(normalizedAction)) {
    return next(new ErrorHandler("Invalid moderation action.", 400));
  }

  const user = await User.findById(id);
  if (!user) {
    return next(new ErrorHandler("User not found.", 404));
  }

  const moderationReason = normalizeModerationReason(reason);

  user.moderationHistory = user.moderationHistory || [];

  if (normalizedAction === "block") {
    user.isBlocked = true;
    user.blockReason = moderationReason;
    user.moderationHistory.push({
      action: "block",
      reason: moderationReason,
    });
    await notifyUserAboutModeration({
      user,
      action: "block",
      reason: moderationReason,
    });
  } else {
    user.isDeleted = true;
    user.deletionReason = moderationReason;
    user.isBlocked = true;
    user.blockReason = moderationReason;
    user.moderationHistory.push({
      action: "delete",
      reason: moderationReason,
    });
    await notifyUserAboutModeration({
      user,
      action: "delete",
      reason: moderationReason,
    });
  }

  await user.save();
  res.status(200).json({
    success: true,
    message:
      normalizedAction === "block"
        ? "User blocked successfully."
        : "User deleted successfully.",
  });
});

export const monthlyRevenue = catchAsyncErrors(async (req, res, next) => {
  const payments = await Commission.aggregate([
    {
      $group: {
        _id: {
          month: { $month: "$createdAt" },
          year: { $year: "$createdAt" },
        },
        totalAmount: { $sum: "$amount" },
      },
    },
    {
      $sort: { "_id.year": 1, "_id.month": 1 },
    },
  ]);

  const tranformDataToMonthlyArray = (payments, totalMonths = 12) => {
    const result = Array(totalMonths).fill(0);

    payments.forEach((payment) => {
      result[payment._id.month - 1] = payment.totalAmount;
    });

    return result;
  };

  const totalMonthlyRevenue = tranformDataToMonthlyArray(payments);
  res.status(200).json({
    success: true,
    totalMonthlyRevenue,
  });
});

export const getCommissionSummary = catchAsyncErrors(async (req, res, next) => {
  const [paidCommission, unpaidCommission] = await Promise.all([
    Commission.aggregate([
      {
        $group: {
          _id: null,
          totalPaidCommission: { $sum: "$amount" },
        },
      },
    ]),
    User.aggregate([
      {
        $group: {
          _id: null,
          totalUnpaidCommission: { $sum: "$unpaidCommission" },
        },
      },
    ]),
  ]);

  const [recentPayments, unpaidUsers] = await Promise.all([
    Commission.find({}).sort({ createdAt: -1 }).limit(10).populate("user", "userName email role"),
    User.find({ unpaidCommission: { $gt: 0 } })
      .select("userName email role unpaidCommission")
      .sort({ unpaidCommission: -1 })
      .limit(20),
  ]);

  res.status(200).json({
    success: true,
    totalPaidCommission: paidCommission[0]?.totalPaidCommission || 0,
    totalUnpaidCommission: unpaidCommission[0]?.totalUnpaidCommission || 0,
    recentPayments,
    unpaidUsers,
  });
});

export const getModerationLog = catchAsyncErrors(async (req, res, next) => {
  const [users, auctions] = await Promise.all([
    User.find({ moderationHistory: { $exists: true, $ne: [] } })
      .select("userName email role moderationHistory")
      .sort({ createdAt: -1 }),
    Auction.find({ moderationHistory: { $exists: true, $ne: [] } })
      .select("title createdBy moderationHistory")
      .populate("createdBy", "userName email role")
      .sort({ createdAt: -1 }),
  ]);

  const moderationEntries = [
    ...users.flatMap((user) =>
      (user.moderationHistory || []).map((entry) => ({
        id: `${user._id}-${entry.action}-${String(entry.createdAt || Date.now())}`,
        type: "user",
        targetName: user.userName,
        email: user.email,
        role: user.role,
        action: entry.action,
        reason: entry.reason,
        createdAt: entry.createdAt || new Date(),
      }))
    ),
    ...auctions.flatMap((auction) =>
      (auction.moderationHistory || []).map((entry) => ({
        id: `${auction._id}-${entry.action}-${String(entry.createdAt || Date.now())}`,
        type: "auction",
        targetName: auction.title,
        email: auction.createdBy?.email || "N/A",
        role: auction.createdBy?.role || "Auctioneer",
        action: entry.action,
        reason: entry.reason,
        createdAt: entry.createdAt || new Date(),
      }))
    ),
  ].sort((first, second) => new Date(second.createdAt) - new Date(first.createdAt));

  res.status(200).json({
    success: true,
    moderationLog: moderationEntries,
  });
});