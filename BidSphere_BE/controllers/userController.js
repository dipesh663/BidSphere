import { catchAsyncErrors } from "../middlewares/catchAsyncErrors.js";
import ErrorHandler from "../middlewares/error.js";
import { User } from "../models/userSchema.js";
import {v2 as cloudinary} from "cloudinary";
import { generateToken } from "../utils/jwtToken.js";

export const register = catchAsyncErrors(async(req, res, next) => {
    if(!req.files || Object.keys(req.files).length === 0) {
        return next(new ErrorHandler("Profile Image Required.", 400));
    }

    const {profileImage} = req.files;

    const allowedFormates = ["image/png", "image/jpeg", "image/webp"];
    if (!allowedFormates.includes(profileImage.mimetype)){
        return next(new ErrorHandler("File format not supported.", 400));
    }

    const{
        userName,
        email,password, phone, address, role, bankAccountNumber, bankAccountHolderName, bankName,
        esewaAccountNumber, khaltiAccountNumber
    } = req.body;

    if(!userName || !email || !password || !role || !address){
        return next(new ErrorHandler("please fill user detail.", 400));
    }
    if(role === "Auctioneer"){
        console.log("Auctioneer" + bankAccountNumber);
        console.log("Auctioneer" + bankAccountHolderName);
        console.log("Auctioneer" + bankName);
        if(!bankAccountNumber || !bankAccountHolderName || !bankName){
            return next(
                new ErrorHandler("please fill bank detail.", 400)
            );       
        }
        if(!esewaAccountNumber){
                return next(
                    new ErrorHandler("please provide your esewaAccountNumber.", 400)
                );       
        }
        if(!khaltiAccountNumber){
            return next(
                new ErrorHandler("please provide your khaltiAccountNumber.", 400)
            );       
        }
    }

    const isRegistered = await User.findOne({email});
    if(isRegistered){
        return next(new ErrorHandler("User already registered.", 400));
    }
    const cloudinaryResponse = await cloudinary.uploader.upload(profileImage.tempFilePath,{
        folder: "BidSphere/Profiles",
    });
    if (!cloudinaryResponse || cloudinaryResponse.error){
        console.error("Cloudinary upload error:", 
            cloudinaryResponse.error || "Unknown cloudinary error.");
        return next(new ErrorHandler("Failed to upload profile image to Cloudinary.", 500));
    }

    const user = await User.create({
        userName,
        email,
        password,
        phone,
        address,
        role,
        profileImage:{
            public_id: cloudinaryResponse.public_id,
            url: cloudinaryResponse.secure_url,
        },
        paymentMethod: {
            bankTransfer: {
                bankAccountNumber,
                bankAccountHolderName,
                bankName
            },
            eSewa: {
                esewaAccountNumber
            },
            khalti: {
                khaltiAccountNumber
            },
        },
    });

    generateToken(user, "User registered successfully.", 201, res);
});

export const login = catchAsyncErrors(async(req, res, next) => {
    const {email, password} = req.body;
    if(!email || !password){
        return next(new ErrorHandler("Please provide email and password.", 400));
    }

    const user = await User.findOne({email}).select("+password");
    if(!user){
        return next(new ErrorHandler("Invalid credentials.", 401));
    }

    const isPasswordMatched = await user.comparePassword(password);
    if(!isPasswordMatched){
        return next(new ErrorHandler("Invalid credentials.", 401));
    }

    generateToken(user, "Login successful.", 200, res);
});

export const getProfile = catchAsyncErrors(async(req, res, next) => {
    const user = req.user;
    res.status(200).json({
        success: true,
        user,
    }); 
});

export const logout = catchAsyncErrors(async(req, res, next) => {
    res.status(200).cookie("token", "", {
        expires: new Date(Date.now()),
        httpOnly: true,
    }).json({
        success: true,
        message: "Logged out successfully.",
    });
});


export const fetchLeaderboard = catchAsyncErrors(async(req, res, next) => {
    const users = await User.find({moneySpent: {$gt: 0}});
    //algorithm to sort users based on money spent in descending order
    const leaderboard = users.sort((a, b) => b.moneySpent - a.moneySpent);
    res.status(200).json({
        success: true,
        leaderboard,
    });
});