import crypto from "crypto";

export const getEsewaConfig = () => {
  const env = (process.env.ESEWA_ENV || "uat").toLowerCase();
  const isLive = env === "live" || env === "production";

  return {
    productCode: process.env.ESEWA_PRODUCT_CODE || "EPAYTEST",
    secretKey: process.env.ESEWA_SECRET_KEY || "8gBm/:&EnhH.1/q",
    formUrl: isLive
      ? "https://epay.esewa.com.np/api/epay/main/v2/form"
      : "https://rc-epay.esewa.com.np/api/epay/main/v2/form",
    statusUrl: isLive
      ? "https://esewa.com.np/api/epay/transaction/status/"
      : "https://rc.esewa.com.np/api/epay/transaction/status/",
  };
};

export const createHmacSignature = (message, secretKey) => {
  return crypto.createHmac("sha256", secretKey).update(message).digest("base64");
};

export const buildSignedMessage = (payload, signedFieldNames) => {
  return signedFieldNames
    .split(",")
    .map((field) => `${field}=${payload[field]}`)
    .join(",");
};

export const generateRequestSignature = ({
  totalAmount,
  transactionUuid,
  productCode,
  secretKey,
}) => {
  const signedFieldNames = "total_amount,transaction_uuid,product_code";
  const message = `total_amount=${totalAmount},transaction_uuid=${transactionUuid},product_code=${productCode}`;
  return {
    signature: createHmacSignature(message, secretKey),
    signedFieldNames,
  };
};

export const verifyResponseSignature = (decoded, secretKey) => {
  if (!decoded?.signature || !decoded?.signed_field_names) {
    return false;
  }
  const message = buildSignedMessage(decoded, decoded.signed_field_names);
  const expected = createHmacSignature(message, secretKey);
  return expected === decoded.signature;
};

export const decodeEsewaResponse = (encodedData) => {
  const json = Buffer.from(encodedData, "base64").toString("utf-8");
  return JSON.parse(json);
};

export const formatEsewaAmount = (amount) => {
  const n = Number(amount);
  if (Number.isNaN(n)) return "0";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
};

export const parseEsewaAmount = (value) => {
  if (typeof value === "number") return value;
  return Number(String(value).replace(/,/g, ""));
};

export const createTransactionUuid = (prefix) => {
  const stamp = Date.now();
  const random = Math.floor(Math.random() * 100000);
  return `${prefix}-${stamp}-${random}`;
};

export const buildEsewaFormPayload = ({
  amount,
  taxAmount = 0,
  productServiceCharge = 0,
  productDeliveryCharge = 0,
  transactionUuid,
  successUrl,
  failureUrl,
}) => {
  const { productCode, secretKey } = getEsewaConfig();
  const totalAmount = formatEsewaAmount(
    Number(amount) +
      Number(taxAmount) +
      Number(productServiceCharge) +
      Number(productDeliveryCharge)
  );
  const baseAmount = formatEsewaAmount(amount);
  const { signature, signedFieldNames } = generateRequestSignature({
    totalAmount,
    transactionUuid,
    productCode,
    secretKey,
  });

  return {
    amount: baseAmount,
    tax_amount: formatEsewaAmount(taxAmount),
    total_amount: totalAmount,
    transaction_uuid: transactionUuid,
    product_code: productCode,
    product_service_charge: formatEsewaAmount(productServiceCharge),
    product_delivery_charge: formatEsewaAmount(productDeliveryCharge),
    success_url: successUrl,
    failure_url: failureUrl,
    signed_field_names: signedFieldNames,
    signature,
  };
};

export const checkEsewaStatus = async ({
  productCode,
  totalAmount,
  transactionUuid,
}) => {
  const { statusUrl } = getEsewaConfig();
  const params = new URLSearchParams({
    product_code: productCode,
    total_amount: String(totalAmount).replace(/,/g, ""),
    transaction_uuid: transactionUuid,
  });

  const response = await fetch(`${statusUrl}?${params.toString()}`);
  if (!response.ok) {
    throw new Error("Unable to reach eSewa status API.");
  }
  return response.json();
};
