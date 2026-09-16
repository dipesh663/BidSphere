import mongoose from "mongoose";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const userSchema = new mongoose.Schema({
    userName: {
        type: String,
        minlength: [3, "Username must be at least 3 characters long"],
        maxlength: [30, "Username must be less than 30 characters long"],
    },
    password: {
        type: String,
        select: false,
        validate: {
            validator: function (value) {
                if (!this.isModified("password")) {
                    return true;
                }
                return typeof value === "string" && value.length >= 8 && value.length <= 20;
            },
            message: "Password must contain between 8 and 20 characters.",
        },
    },
    email: {
        type: String,
        required: true,
        unique: true,
    },
    address: String,
    phone: {
        type: String,
        minlength: [10, "Phone number must contain 10 digits."],
        maxlength: [10, "Phone number cannot exceed 10 digits."],
    },
    profileImage: {
        public_id: {
            type: String,
            required: true,
        },
        url: {
            type: String,
            required: true,
        },
    },

    paymentMethod: {
        esewa: {
            esewaAccountNumber: String,
            esewaAccountHolderName: String,
        },
    },

    role: {
        type: String,
        enum: ["Auctioneer", "Bidder", "SuperAdmin"],
    },
    isBlocked: {
        type: Boolean,
        default: false,
    },
    blockReason: {
        type: String,
        default: "",
    },
    isDeleted: {
        type: Boolean,
        default: false,
    },
    deletionReason: {
        type: String,
        default: "",
    },
    moderationHistory: [
        {
            action: {
                type: String,
                enum: ["block", "delete"],
            },
            reason: String,
            createdAt: {
                type: Date,
                default: Date.now,
            },
        },
    ],
    unpaidCommission: {
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

userSchema.pre("save", async function () {
    if (!this.isModified("password")) {
        return;
    }
    this.password = await bcrypt.hash(this.password, 10);
});

userSchema.methods.comparePassword = async function (enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.generateToken = function () {
    return jwt.sign({ id: this._id }, process.env.JWT_SECRET_KEY, {
        expiresIn: process.env.JWT_EXPIRES_IN,
    });
};

export const User = mongoose.model("User", userSchema);

