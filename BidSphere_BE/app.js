import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import fileUpload from "express-fileupload";
import { connectDB } from "./database/connection.js";
import { config } from "dotenv";
import { errorMiddleware } from "./middlewares/error.js";
import userRoutes from "./router/userRoutes.js";
import auctionItemRouter from "./router/auctionItemRoutes.js";
import bidRouter from "./router/bidRoutes.js"
import commissionRouter from "./router/commissionRouter.js";
import superAdminRouter  from "./router/superAdminRoutes.js";
import { endedAuctionCron } from "./automation/endedAuctionCron.js"
import { verifyCommissionCron } from "./automation/verifyCommissionCron.js"

const app = express();
config({
    path: "./config/config.env"
});


app.use(cors(
    {
        origin: [process.env.FRONTEND_URL],
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true,
    }
));

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
    useTempFiles: true,
    tempFileDir: "/tmp/",
}));

app.use("/api/v1/users", userRoutes);
app.use("/api/v1/auctionitem", auctionItemRouter);
app.use("/api/v1/bid", bidRouter);
app.use("/api/v1/commission", commissionRouter);
app.use("/api/v1/superadmin", superAdminRouter);

endedAuctionCron();
verifyCommissionCron();
connectDB();

app.use(errorMiddleware);


export default app;