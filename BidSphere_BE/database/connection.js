import mongoose from "mongoose";

export const connectDB = () => {
    mongoose.connect(process.env.MONGO_URI, {
    dbName: "Bid_Sphere"
    }).then(() => {
        console.log("Connected to database");
    }).catch((err) => {
        console.log(`some error occurred while connecting to the database: ${err}`);
    });
};  