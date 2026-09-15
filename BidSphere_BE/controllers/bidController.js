import { catchAsyncErrors } from "../middlewares/catchAsyncErrors.js";
import ErrorHandler from "../middlewares/error.js";
import { Auction } from "../models/auctionSchema.js";
import { Bid } from "../models/bidSchema.js";
import { User } from "../models/userSchema.js";

// Countdown reset durations in seconds for each step (0-indexed, capped at index 3)
const COUNTDOWN_STEPS = [60, 40, 20, 10];

/**
 * Returns the countdown duration (ms) for the current step.
 */
function getCountdownMs(step) {
    const s = Math.min(step, COUNTDOWN_STEPS.length - 1);
    return COUNTDOWN_STEPS[s] * 1000;
}

/**
 * Calculates the allowed increment range for bidding.
 * - The increment is 10% to 50% of the base amount.
 * - Steps are rounded to a natural unit (100, 1000, 10000, etc.)
 */
function getIncrementRange(baseAmount) {
    const tenPercent = baseAmount * 0.10;
    const fiftyPercent = baseAmount * 0.50;

    const exp = Math.floor(Math.log10(Math.max(tenPercent, 1)));
    const unit = Math.pow(10, exp);

    const minIncrement = Math.ceil(tenPercent / unit) * unit;
    const maxIncrement = Math.floor(fiftyPercent / unit) * unit;

    return {
        minIncrement: Math.max(minIncrement, unit),
        maxIncrement: Math.max(maxIncrement, minIncrement),
    };
}

export const placeBid = catchAsyncErrors(async (req, res, next) => {
    const { id } = req.params;
    const auctionItem = await Auction.findById(id);
    if (!auctionItem) {
        return next(new ErrorHandler("Auction Item not found.", 404));
    }

    // ── Role guard: Auctioneers cannot place bids ─────────────────────────
    if (req.user.role === "Auctioneer") {
        return next(new ErrorHandler(
            "Auctioneers are not allowed to place bids. Only Bidders can participate in auctions.",
            403
        ));
    }

    const now = new Date();

    // ── Auction active guard ──────────────────────────────────────────────────
    // Use dynamicEndTime if countdown is active, otherwise use original endTime
    const effectiveEnd = auctionItem.countdownActive && auctionItem.dynamicEndTime
        ? auctionItem.dynamicEndTime
        : new Date(auctionItem.endTime);

    if (now < new Date(auctionItem.startTime)) {
        return next(new ErrorHandler("Auction has not started yet.", 400));
    }
    if (now > effectiveEnd) {
        return next(new ErrorHandler("Auction has already ended.", 400));
    }

    // ── Amount validation ─────────────────────────────────────────────────────
    const { amount } = req.body;
    if (!amount) {
        return next(new ErrorHandler("Please place your bid.", 400));
    }

    const base = auctionItem.currentBid > 0 ? auctionItem.currentBid : auctionItem.startingBid;
    const { minIncrement, maxIncrement } = getIncrementRange(base);
    const minBid = base + minIncrement;
    const maxBid = base + maxIncrement;

    if (Number(amount) < minBid) {
        return next(new ErrorHandler(
            `Bid must be at least Rs.${minBid} (current + min increment Rs.${minIncrement}).`,
            400
        ));
    }
    if (Number(amount) > maxBid) {
        return next(new ErrorHandler(
            `Bid cannot exceed Rs.${maxBid} (current + max increment Rs.${maxIncrement}).`,
            400
        ));
    }
    if (Number(amount) < auctionItem.startingBid) {
        return next(new ErrorHandler("Bid amount must be greater than starting bid.", 400));
    }

    try {
        const existingBid = await Bid.findOne({
            "bidder.id": req.user._id,
            auctionItem: auctionItem._id,
        });
        const existingBidInAuction = auctionItem.bids.find(
            (bid) => bid.userId.toString() === req.user._id.toString()
        );
        const bidTime = new Date();

        if (existingBid && existingBidInAuction) {
            existingBidInAuction.amount = Number(amount);
            existingBidInAuction.time = bidTime;
            existingBid.amount = Number(amount);
            await existingBid.save();
            auctionItem.currentBid = Number(amount);
        } else {
            const bidderDetail = await User.findById(req.user._id);
            await Bid.create({
                amount: Number(amount),
                bidder: {
                    id: bidderDetail._id,
                    userName: bidderDetail.userName,
                    profileImage: bidderDetail.profileImage?.url,
                },
                auctionItem: auctionItem._id,
            });
            auctionItem.bids.push({
                userId: req.user._id,
                userName: bidderDetail.userName,
                profileImage: bidderDetail.profileImage?.url,
                amount: Number(amount),
                time: bidTime,
            });
            auctionItem.currentBid = Number(amount);
        }

        // ── Countdown logic ───────────────────────────────────────────────────
        // Assign countdown duration for the CURRENT step, then advance the step
        const currentStep = auctionItem.countdownStep || 0;
        const countdownMs = getCountdownMs(currentStep);
        const newDynamicEndTime = new Date(now.getTime() + countdownMs);

        auctionItem.countdownActive = true;
        auctionItem.dynamicEndTime = newDynamicEndTime;
        // Advance step (max out at last index so it stays at 10s)
        auctionItem.countdownStep = Math.min(currentStep + 1, COUNTDOWN_STEPS.length - 1);
        // ─────────────────────────────────────────────────────────────────────

        await auctionItem.save();

        res.status(201).json({
            success: true,
            message: "Bid Placed.",
            currentBid: auctionItem.currentBid,
            countdownActive: true,
            dynamicEndTime: newDynamicEndTime,
            countdownSeconds: countdownMs / 1000,
            minIncrement,
            maxIncrement,
        });
    } catch (error) {
        return next(new ErrorHandler(error.message || "Failed to place bid.", 500));
    }
});