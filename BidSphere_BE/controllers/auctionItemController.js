import { Auction } from '../models/auctionSchema.js';
import { User } from '../models/userSchema.js';
import { Bid } from '../models/bidSchema.js';
import { EsewaTransaction } from '../models/esewaTransactionSchema.js';
import { applyCommissionOnAuctionPayment } from './commissionController.js';
import { catchAsyncErrors } from '../middlewares/catchAsyncErrors.js';
import ErrorHandler from '../middlewares/error.js';
import { v2 as cloudinary } from 'cloudinary';
import mongoose from 'mongoose';
import { sendEmail } from '../utils/sendEmail.js';

const isAuctionEnded = (auction) => {
  const effectiveEndTime = auction.countdownActive && auction.dynamicEndTime && auction.bids?.length > 0
    ? auction.dynamicEndTime
    : auction.endTime;
  return new Date(effectiveEndTime).getTime() <= Date.now();
};

const isPaid = (auction) => auction.paymentStatus === "paid" || auction.bidderPaid === true;

const hasBids = (auction) => Array.isArray(auction.bids) && auction.bids.length > 0;

const ensureOwner = (auction, userId, next) => {
  if (String(auction.createdBy) !== String(userId)) {
    next(new ErrorHandler("You can only manage your own auctions.", 403));
    return false;
  }
  return true;
};

const canPerformPostPaymentAction = (auction, action) =>
  !hasBids(auction) || (
    auction.postPaymentAction === action &&
    auction.paymentDeadline && new Date(auction.paymentDeadline) <= new Date()
  );

export const addNewAuctionItem = catchAsyncErrors(async (req, res, next) => {
  if (!req.files || Object.keys(req.files).length === 0) {
    return next(new ErrorHandler("Auction item image required.", 400));
  }

  const { image } = req.files;

  const allowedFormats = ["image/png", "image/jpeg", "image/webp"];
  if (!allowedFormats.includes(image.mimetype)) {
    return next(new ErrorHandler("File format not supported.", 400));
  }

  const {
    title,
    description,
    category,
    condition,
    startingBid,
    startTime,
    endTime,
  } = req.body;
  if (
    !title ||
    !description ||
    !category ||
    !condition ||
    !startingBid ||
    !startTime ||
    !endTime
  ) {
    return next(new ErrorHandler("Please provide all details.", 400));
  }
  if (new Date(startTime) < Date.now()) {
    return next(
      new ErrorHandler(
        "Auction starting time must be greater than present time.",
        400
      )
    );
  }
  if (new Date(startTime) >= new Date(endTime)) {
    return next(
      new ErrorHandler(
        "Auction starting time must be less than ending time.",
        400
      )
    );
  }
  const auctionsByAuctioneer = await Auction.find({
    createdBy: req.user._id,
  }).select("endTime");
  const hasActiveAuction = auctionsByAuctioneer.some(
    (auction) => auction.endTime && new Date(auction.endTime).getTime() > Date.now()
  );
  if (hasActiveAuction) {
    return next(new ErrorHandler("You already have one active auction.", 400));
  }
  try {
    const cloudinaryResponse = await cloudinary.uploader.upload(
      image.tempFilePath,
      {
        folder: "MERN_AUCTION_PLATFORM_AUCTIONS",
      }
    );
    if (!cloudinaryResponse || cloudinaryResponse.error) {
      console.error(
        "Cloudinary error:",
        cloudinaryResponse.error || "Unknown cloudinary error."
      );
      return next(
        new ErrorHandler("Failed to upload auction image to cloudinary.", 500)
      );
    }
    const auctionItem = await Auction.create({
      title,
      description,
      category,
      condition,
      startingBid,
      startTime,
      endTime,
      image: {
        public_id: cloudinaryResponse.public_id,
        url: cloudinaryResponse.secure_url,
      },
      createdBy: req.user._id,
    });
    return res.status(201).json({
      success: true,
      message: `Auction item created and will be listed on auction page at ${startTime}`,
      auctionItem,
    });
  } catch (error) {
    return next(
      new ErrorHandler(error.message || "Failed to created auction.", 500)
    );
  }
});

export const getAllItems = catchAsyncErrors(async (req, res, next) => {
  let items = await Auction.find();
  res.status(200).json({
    success: true,
    items,
  });
});

export const getAuctionDetails = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorHandler("Invalid Id format.", 400));
  }
  const auctionItem = await Auction.findById(id).populate(
    "createdBy",
    "userName email phone profileImage"
  );
  if (!auctionItem) {
    return next(new ErrorHandler("Auction not found.", 404));
  }

  const gatewayTxn = await EsewaTransaction.findOne({
    auctionId: auctionItem._id,
    purpose: "auction",
    status: { $in: ["PENDING", "COMPLETE"] },
  });
  if (gatewayTxn?.status === "COMPLETE" && auctionItem.paymentStatus !== "paid") {
    auctionItem.paymentStatus = "paid";
    auctionItem.paymentMethod = "esewa";
    auctionItem.paymentRef = gatewayTxn.esewaRefId || gatewayTxn.transactionCode;
    auctionItem.paymentTransactionId = gatewayTxn._id;
    await auctionItem.save();
    await applyCommissionOnAuctionPayment(auctionItem._id);
  } else if (auctionItem.paymentStatus === "paid" && !auctionItem.commissionCalculated) {
    await applyCommissionOnAuctionPayment(auctionItem._id);
  } else if (
    gatewayTxn?.status === "PENDING" &&
    auctionItem.paymentStatus !== "paid" &&
    auctionItem.paymentStatus !== "pending"
  ) {
    auctionItem.paymentStatus = "pending";
    auctionItem.paymentMethod = "esewa";
    auctionItem.paymentTransactionId = gatewayTxn._id;
    await auctionItem.save();
  }

  const bidders = auctionItem.bids.sort((a, b) => b.amount - a.amount);
  const winningBidder = auctionItem.highestBidder
    ? await User.findById(auctionItem.highestBidder).select(
        "userName email phone profileImage"
      )
    : bidders[0]?.userId
      ? await User.findById(bidders[0].userId).select(
          "userName email phone profileImage"
        )
      : null;

  // Resolve the winner immediately if the ending cron has not run yet.
  const effectiveEnd =
    auctionItem.countdownActive && auctionItem.dynamicEndTime && auctionItem.bids?.length > 0
      ? auctionItem.dynamicEndTime
      : auctionItem.endTime;
  if (!auctionItem.highestBidder && bidders[0]?.userId && new Date(effectiveEnd) <= new Date()) {
    auctionItem.highestBidder = bidders[0].userId;
    await auctionItem.save();
  }

  let auctioneerPaymentInfo = null;
  const isWinner =
    auctionItem.highestBidder &&
    String(auctionItem.highestBidder) === String(req.user._id);
  if (isWinner) {
    const auctioneer = await User.findById(
      auctionItem.createdBy?._id || auctionItem.createdBy
    ).select(
      "userName email paymentMethod"
    );
    auctioneerPaymentInfo = auctioneer;
  }

  res.status(200).json({
    success: true,
    auctionItem,
    bidders,
    winningBidder,
    auctioneerPaymentInfo,
  });
});

export const getMyAuctionItems = catchAsyncErrors(async (req, res, next) => {
  const items = await Auction.find({ createdBy: req.user._id });
  res.status(200).json({
    success: true,
    items,
  });
});

export const removeFromAuction = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorHandler("Invalid Id format.", 400));
  }
  const auctionItem = await Auction.findById(id);
  if (!auctionItem) {
    return next(new ErrorHandler("Auction not found.", 404));
  }
  if (!ensureOwner(auctionItem, req.user._id, next)) return;
  if (!isAuctionEnded(auctionItem)) {
    return next(new ErrorHandler("An active auction cannot be deleted.", 400));
  }
  if (isPaid(auctionItem)) {
    return next(
      new ErrorHandler(
        "This auction item has already been paid for by the winning bidder and cannot be deleted.",
        400
      )
    );
  }
  if (!canPerformPostPaymentAction(auctionItem, "delete")) {
    return next(new ErrorHandler("Choose delete and notify the winner first. Deletion is available after the 7-day payment deadline.", 400));
  }
  await auctionItem.deleteOne();
  res.status(200).json({
    success: true,
    message: "Auction item deleted successfully.",
  });
});

export const choosePostPaymentAction = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  const { action } = req.body;
  if (!mongoose.Types.ObjectId.isValid(id)) return next(new ErrorHandler("Invalid Id format.", 400));
  if (!["delete", "republish"].includes(action)) return next(new ErrorHandler("Action must be delete or republish.", 400));

  const auctionItem = await Auction.findById(id);
  if (!auctionItem) return next(new ErrorHandler("Auction not found.", 404));
  if (!ensureOwner(auctionItem, req.user._id, next)) return;
  if (!isAuctionEnded(auctionItem)) return next(new ErrorHandler("An active auction cannot be changed.", 400));
  if (!hasBids(auctionItem)) return next(new ErrorHandler("This auction has no winning bidder; you can delete or republish it now.", 400));
  if (isPaid(auctionItem)) return next(new ErrorHandler("The winning bidder has paid, so this auction cannot be deleted or republished.", 400));
  if (auctionItem.postPaymentAction !== "none") return next(new ErrorHandler("A post-payment action has already been selected for this auction.", 400));

  // The cron job normally assigns highestBidder. Resolve it here as well so
  // auction management cannot bypass protection during the cron interval.
  const winningBid = auctionItem.highestBidder
    ? null
    : await Bid.findOne({ auctionItem: auctionItem._id }).sort({ amount: -1 });
  const winnerId = auctionItem.highestBidder || winningBid?.bidder?.id;
  if (!winnerId) return next(new ErrorHandler("Could not determine the winning bidder.", 400));
  auctionItem.highestBidder = winnerId;
  const winner = await User.findById(winnerId).select("userName email");
  const paymentDeadline = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  auctionItem.postPaymentAction = action;
  auctionItem.paymentDeadline = paymentDeadline;
  auctionItem.postPaymentActionNotifiedAt = new Date();
  await auctionItem.save();

  if (winner?.email) {
    const actionText = action === "delete" ? "remove the auction" : "republish the auction";
    await sendEmail({
      email: winner.email,
      subject: `Payment required for your winning bid: ${auctionItem.title}`,
      message: `Dear ${winner.userName},\n\nYou won "${auctionItem.title}". The auctioneer has selected an action to ${actionText} if payment is not received. Please complete payment within 7 days, by ${paymentDeadline.toLocaleString()}.\n\nOnce payment is confirmed, this auction will be protected and cannot be removed or republished.\n\nThank you.`,
    });
  }
  res.status(200).json({ success: true, auctionItem, message: `Winner notified. ${action} will be available after ${paymentDeadline.toLocaleString()} if payment is not completed.` });
});

export const republishItem = catchAsyncErrors(async (req, res, next) => {
  const { id } = req.params;
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return next(new ErrorHandler("Invalid Id format.", 400));
  }
  let auctionItem = await Auction.findById(id);
  if (!auctionItem) {
    return next(new ErrorHandler("Auction not found.", 404));
  }
  if (!ensureOwner(auctionItem, req.user._id, next)) return;
  if (!isAuctionEnded(auctionItem)) {
    return next(new ErrorHandler("An active auction cannot be republished.", 400));
  }
  if (isPaid(auctionItem)) {
    return next(
      new ErrorHandler(
        "This auction item has already been paid for by the winning bidder and cannot be republished.",
        400
      )
    );
  }
  if (!canPerformPostPaymentAction(auctionItem, "republish")) {
    return next(new ErrorHandler("Choose republish and notify the winner first. Republishing is available after the 7-day payment deadline.", 400));
  }
  if (!req.body.startTime || !req.body.endTime) {
    return next(
      new ErrorHandler("Starttime and Endtime for republish is mandatory.")
    );
  }
  let data = {
    startTime: new Date(req.body.startTime),
    endTime: new Date(req.body.endTime),
  };
  if (data.startTime < Date.now()) {
    return next(
      new ErrorHandler(
        "Auction starting time must be greater than present time",
        400
      )
    );
  }
  if (data.startTime >= data.endTime) {
    return next(
      new ErrorHandler(
        "Auction starting time must be less than ending time.",
        400
      )
    );
  }

  if (auctionItem.highestBidder) {
    const highestBidder = await User.findById(auctionItem.highestBidder);
    highestBidder.moneySpent -= auctionItem.currentBid;
    highestBidder.auctionsWon -= 1;
    highestBidder.save();
  }

  data.bids = [];
  data.commissionCalculated = false;
  // A republished auction is a new bidding cycle.  Leaving the previous
  // dynamic countdown in place makes clients use its already-expired value
  // instead of the new endTime.
  data.endedHandled = false;
  data.countdownActive = false;
  data.countdownStep = 0;
  data.dynamicEndTime = null;
  data.currentBid = 0;
  data.highestBidder = null;
  data.paymentStatus = "unpaid";
  data.paymentMethod = "none";
  data.paymentRef = null;
  data.paymentTransactionId = null;
  data.postPaymentAction = "none";
  data.paymentDeadline = null;
  data.postPaymentActionNotifiedAt = null;
  await EsewaTransaction.updateMany(
    {
      auctionId: id,
      purpose: "auction",
      status: { $in: ["PENDING", "COMPLETE"] },
    },
    { status: "CANCELED" }
  );
  auctionItem = await Auction.findByIdAndUpdate(id, data, {
    new: true,
    runValidators: true,
    useFindAndModify: false,
  });
  await Bid.deleteMany({ auctionItem: auctionItem._id });
  const createdBy = await User.findByIdAndUpdate(
    req.user._id,
    { unpaidCommission: 0 },
    {
      new: true,
      runValidators: false,
      useFindAndModify: false,
    }
  );
  res.status(200).json({
    success: true,
    auctionItem,
    message: `Auction republished and will be active on ${req.body.startTime}`,
    createdBy,
  });
});
