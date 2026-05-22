import ErrorHandler from "../middlewares/error.js";

export const register = () => {
    if(!req.files || Object.keys(req.files).length === 0) {
        return next(new ErrorHandler("Profile Image Required.", 400));
    }

    const {profileImage} = req.files;

    const allowedFormates = ["image/png", "image/jpg", "image/webp"];
    if (!allowedFormates.includes(profileImage.mimetype)){
        return next(new ErrorHandler("File format not supported.", 400));
    }

    const{
        userName,
        email,password, phone, address, role, bankAccountnumber, bankAccountHolderName, bankName,
        esewaAccountNumber, khaltiAccountNumber, paypalEmail
    } = req.body;
};