import mongoose from "mongoose";
import { catchAsyncErrors } from "./catchAsyncErrors.js";
import ErrorHandler from "./error.js";
import { Auction } from "../models/auctionSchema.js";


export const checkAuctionEndTime = catchAsyncErrors(async (req, res, next) => {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
        return next(new ErrorHandler("Invalid Id format.", 400));
    }
    const auction = await Auction.findById(id);
    if (!auction) {
        return next(new ErrorHandler("Auction not found.", 404));
    }
    const now = new Date();
    if (new Date(auction.startTime) > now) {
        return next(new ErrorHandler("Auction has not started yet.", 400));
    }
    // Once bidding activates the countdown, it is the authoritative end time.
    // This must match the check in placeBid and the value shown in the UI.
    const effectiveEndTime = auction.countdownActive && auction.dynamicEndTime && auction.bids?.length > 0
        ? new Date(auction.dynamicEndTime)
        : new Date(auction.endTime);
    if (effectiveEndTime < now) {
        return next(new ErrorHandler("Auction has ended.", 400));
    }
    next();
});