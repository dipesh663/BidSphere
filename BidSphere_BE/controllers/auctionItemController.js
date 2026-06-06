import { Auction} from '../models/auctionSchema.js';
import { User } from '../models/userSchema.js';
import { catchAsyncErrors } from '../middlewares/catchAsyncErrors.js';
import ErrorHandler from '../utils/errorHandler.js';

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

    


});