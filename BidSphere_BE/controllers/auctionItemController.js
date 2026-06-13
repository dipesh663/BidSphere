import { Auction} from '../models/auctionSchema.js';
import { User } from '../models/userSchema.js';
import { catchAsyncErrors } from '../middlewares/catchAsyncErrors.js';
import ErrorHandler from '../middlewares/error.js';
import {v2 as cloudinary} from 'cloudinary';
import mongoose from 'mongoose';

export const addNewAuctionItem = catchAsyncErrors(async (req, res, next) => {
    if(!req.files || Object.keys(req.files).length === 0) {
        return next(new ErrorHandler(" Auction Item Image Required.", 400));
    }

    const {image} = req.files;

    const allowedFormates = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedFormates.includes(image.mimetype)){
        return next(new ErrorHandler("File format not supported.", 400));
    }

    const {title, description, category, startingBid, startTime, endTime} = req.body;
    
    if(!title || !description || !category || !startingBid || !startTime || !endTime){
        return next(new ErrorHandler("Please provide all required details.", 400));
    }
    if (new Date(startTime) < Date.now()) {
        return next(new ErrorHandler
            ("Auction starting time must be greater than present time.", 400));
    }
     if (new Date(startTime) >= new Date(endTime)) {
        return next(new ErrorHandler
            ("Auction starting time must be less than end time.", 400));
    }

    const alreadyOneAuctionActive = await Auction.find({
        createdBy: req.user._id,
        endTime: { $gt: new Date() },
    });
    if (alreadyOneAuctionActive.length > 0) {
        return next(new ErrorHandler("You already have an active auction.", 400)
    );
    }
    try {
        const cloudinaryResponse = await cloudinary.uploader.upload(image.tempFilePath,{
        folder: "BidSphere_Auctions_images",
    });
    if (!cloudinaryResponse || cloudinaryResponse.error){
        console.error("Cloudinary upload error:", 
            cloudinaryResponse.error || "Unknown cloudinary error.");
        return next(new ErrorHandler("Failed to upload auction image to Cloudinary.", 500));
    }
    const auctionItem = await Auction.create({
        title,
        description,
        category,
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
        message: `Auction item created and will be listed on auction page at ${startTime}.`,
        auctionItem,
    }); 
    } catch (error) {
        return next(new ErrorHandler(error.message || "Failed to create auction item.", 500));
    }
});

export const getAllItems = catchAsyncErrors(async (req, res, next) =>{
    let items = await Auction.find();
    res.status(200).json({
        success: true,
        items,
    });
});

export const getMyAuctionItems = catchAsyncErrors(async (req, res, next) =>{
    
    
});

export const getAuctionDetails = catchAsyncErrors(async (req, res, next) =>{
    const {id} = req.params;
    if(!mongoose.Types.ObjectId.isValid(id)){
        return next(new ErrorHandler("Invalid Id format.", 400));
    }
    const auctionItem = await Auction.findById(id);
    if(!auctionItem){
        return next(new ErrorHandler("Auction not found.", 404));
    }
    const bidders = auctionItem.bids.sort((a, b) => b.bid - a.bid);
    res.status(200).json({
        success: true,
        auctionItem,
        bidders,
    });
});

export const removeFromAuction = catchAsyncErrors(async (req, res, next) =>{});

export const republishItem = catchAsyncErrors(async (req, res, next) =>{});