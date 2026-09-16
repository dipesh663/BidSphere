import { User } from "../models/userSchema.js";
import jwt from "jsonwebtoken";
import ErrorHandler from "./error.js";
import { catchAsyncErrors } from "./catchAsyncErrors.js";

export const isAuthenticated = catchAsyncErrors(async (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        return next(
            new ErrorHandler("User not authenticated.", 401)
        );
    }

    try {
        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET_KEY
        );

        const user = await User.findById(decoded.id);

        if (!user) {
            return next(
                new ErrorHandler("User not found.", 401)
            );
        }

        req.user = user;

        next();
    } catch (error) {
        return next(
            new ErrorHandler("Invalid or expired token.", 401)
        );
    }
});

export const isAuthorized = (...roles) => {
    return (req, res, next) => {
        const userRole = req.user.role;

        const normalizedRoles = roles.flatMap((role) => [
            role,
            role.replace(" ", "")
        ]);

        if (!normalizedRoles.includes(userRole)) {
            return next(
                new ErrorHandler(
                    `${req.user.role} is not allowed to access this resource.`,
                    403
                )
            );
        }

        next();
    };
};