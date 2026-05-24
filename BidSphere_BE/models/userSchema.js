import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema({
    userName: {
        type: String,
        minlength: [3, "Username must be at least 3 characters long"],
        maxlength: [30, "Username must be less than 30 characters long"],
    },
    password:{
        type: String,
        selected: false,
        minlength: [8, "Password must contain at least 8 characters."],
        maxlength: [20, "Password connot exceed 20 characters."],

    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    address: String,
    phone:{
        type: String, 
        minlength: [10, "Phone number must contain 10 digits."],
        maxlength: [10, "Phone number connot exceed 10 digits."],
    },
    profileImage: {
        public_id:{
            type: String,
            required: true,
        },
        url: {
            type: String,
            required: true,
        },
    },

    paymentMethod: {
        bankTransfer: {
            bankAccountNumber: String,
            bankName: String,
            bankAccountHolderName: String,
        },
        esewa:{
            esewaAccountNumber: String,
            esewaAccountHolderName: String,
        },
        khalti:{
            khaltiAccountNumber: String,
            khaltiAccountHolderName: String,
        },
        paypal:{
            paypalEmail: String,
        },
    },

    role: {
        type: String,
        enum: ["Auctioneer", "Bidder","SuperAdmin"],
    },
    unpaidCommissions: {
        type: Number,
        default: 0,
    },
    auctionsWon: {
        type: Number,
        default: 0,
    },
    moneySpent: {
        type: Number,
        default: 0,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

userSchema.pre("save", async function (next) {
    if (!this.isModified("password")){
        next();
    }
    this.password = await bcrypt.hash(this.password, 10);
});

export const User = mongoose.model("User", userSchema);

