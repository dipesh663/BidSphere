import { catchAsyncErrors } from "../middlewares/catchAsyncErrors.js";
import ErrorHandler from "../middlewares/error.js";
import { User } from "../models/userSchema.js";
import { Auction } from "../models/auctionSchema.js";
import { EsewaTransaction } from "../models/esewaTransactionSchema.js";
import { v2 as cloudinary } from "cloudinary";
import { generateToken } from "../utils/jwtToken.js";

export const register = catchAsyncErrors(async (req, res, next) => {
    if (!req.files || Object.keys(req.files).length === 0) {
        return next(new ErrorHandler("Profile Image Required.", 400));
    }

    const { profileImage } = req.files;

    const allowedFormates = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedFormates.includes(profileImage.mimetype)) {
        return next(new ErrorHandler("File format not supported.", 400));
    }

    const {
        userName,
        email, password, phone, address, role, esewaAccountNumber
    } = req.body;

    const normalizedEmail = String(email || "").trim().toLowerCase();

    if (!userName || !normalizedEmail || !password || !role || !address) {
        return next(new ErrorHandler("please fill user detail.", 400));
    }
    if (role === "Auctioneer") {
        if (!esewaAccountNumber) {
            return next(
                new ErrorHandler("please provide your esewaAccountNumber.", 400)
            );
        }
    }

    const isRegistered = await User.findOne({ email: normalizedEmail });
    if (isRegistered) {
        const blockedMessage = isRegistered.isBlocked || isRegistered.isDeleted
            ? "This email has been blocked and cannot be used to create a new account."
            : "User already registered.";
        return next(new ErrorHandler(blockedMessage, 400));
    }
    const cloudinaryResponse = await cloudinary.uploader.upload(profileImage.tempFilePath, {
        folder: "BidSphere/Profiles",
    });
    if (!cloudinaryResponse || cloudinaryResponse.error) {
        console.error("Cloudinary upload error:",
            cloudinaryResponse.error || "Unknown cloudinary error.");
        return next(new ErrorHandler("Failed to upload profile image to Cloudinary.", 500));
    }

    const user = await User.create({
        userName,
        email: normalizedEmail,
        password,
        phone,
        address,
        role,
        profileImage: {
            public_id: cloudinaryResponse.public_id,
            url: cloudinaryResponse.secure_url,
        },
        paymentMethod: {
            esewa: {
                esewaAccountNumber
            },
        },
    });

    generateToken(user, "User registered successfully.", 201, res);
});

export const login = catchAsyncErrors(async (req, res, next) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return next(new ErrorHandler("Please provide email and password.", 400));
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select("+password");
    if (!user) {
        return next(new ErrorHandler("Invalid credentials.", 401));
    }

    if (user.isBlocked || user.isDeleted) {
        return next(new ErrorHandler("This account has been blocked and cannot log in.", 403));
    }

    const isPasswordMatched = await user.comparePassword(password);
    if (!isPasswordMatched) {
        return next(new ErrorHandler("Invalid credentials.", 401));
    }

    generateToken(user, "Login successful.", 200, res);
});

export const getProfile = catchAsyncErrors(async (req, res, next) => {
    const user = req.user;
    res.status(200).json({
        success: true,
        user,
    });
});

export const logout = catchAsyncErrors(async (req, res, next) => {
    res.status(200).clearCookie("token", {
        httpOnly: true,
        secure: true,
        sameSite: "none",
    }).json({
        success: true,
        message: "Logged out successfully.",
    });
});


export const fetchLeaderboard = catchAsyncErrors(async (req, res, next) => {
    const completedAuctionPayments = await EsewaTransaction.find({
        purpose: "auction",
        status: "COMPLETE",
    }).select("auctionId").lean();
    const completedPaymentAuctionIds = completedAuctionPayments
        .map((transaction) => transaction.auctionId)
        .filter(Boolean);

    const paidAuctions = await Auction.find({
        $or: [
            { paymentStatus: "paid" },
            { bidderPaid: true },
            { _id: { $in: completedPaymentAuctionIds } },
        ],
    }).select("createdBy highestBidder currentBid bids").lean();

    const bidderStats = new Map();
    const auctioneerStats = new Map();

    for (const auction of paidAuctions) {
        const amount = Number(auction.currentBid || 0);
        const highestEmbeddedBid = (auction.bids || []).reduce(
            (current, bid) => (!current || bid.amount > current.amount ? bid : current),
            null
        );
        const winnerId = auction.highestBidder || highestEmbeddedBid?.userId;

        if (winnerId && amount > 0) {
            const bidderId = String(winnerId);
            const current = bidderStats.get(bidderId) || { auctionsWon: 0, moneySpent: 0 };
            current.auctionsWon += 1;
            current.moneySpent += amount;
            bidderStats.set(bidderId, current);
        }

        if (auction.createdBy && amount > 0) {
            const auctioneerId = String(auction.createdBy);
            const current = auctioneerStats.get(auctioneerId) || { auctionsSuccessful: 0, moneyEarned: 0 };
            current.auctionsSuccessful += 1;
            current.moneyEarned += amount;
            auctioneerStats.set(auctioneerId, current);
        }
    }

    const userIds = [...new Set([
        ...bidderStats.keys(),
        ...auctioneerStats.keys(),
    ])];
    const users = await User.find({ _id: { $in: userIds } })
        .select("userName email role profileImage")
        .lean();

    const bidders = users
        .filter((user) => bidderStats.has(String(user._id)))
        .map((user) => ({ ...user, ...bidderStats.get(String(user._id)) }))
        .sort((a, b) => b.moneySpent - a.moneySpent);
    const auctioneers = users
        .filter((user) => auctioneerStats.has(String(user._id)))
        .map((user) => ({ ...user, ...auctioneerStats.get(String(user._id)) }))
        .sort((a, b) => b.moneyEarned - a.moneyEarned);

    res.status(200).json({
        success: true,
        bidders,
        auctioneers,
        leaderboard: bidders,
    });
});
