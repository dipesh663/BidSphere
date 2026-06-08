import { Auction} from '../models/auctionSchema.js';
import { User } from '../models/userSchema.js';
import { catchAsyncErrors } from '../middlewares/catchAsyncErrors.js';
import ErrorHandler from '../middlewares/error.js';
import {v2 as cloudinary} from 'cloudinary';

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
    if (alreadyOneAuctionActive) {
        return next(new ErrorHandler("You already have an active auction.")
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