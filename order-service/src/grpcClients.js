import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CUSTOMER_PROTO_PATH = path.resolve(
  __dirname,
  "../../proto/customer.proto"
);

const PRODUCT_PROTO_PATH = path.resolve(
  __dirname,
  "../../proto/product.proto"
);

const customerPackageDefinition = protoLoader.loadSync(
  CUSTOMER_PROTO_PATH,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }
);

const productPackageDefinition = protoLoader.loadSync(
  PRODUCT_PROTO_PATH,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }
);

const customerProto =
  grpc.loadPackageDefinition(customerPackageDefinition).customer;

const productProto =
  grpc.loadPackageDefinition(productPackageDefinition).product;

const customerClient = new customerProto.CustomerService(
  process.env.CUSTOMER_GRPC_ADDRESS || "localhost:50051",
  grpc.credentials.createInsecure()
);

const productClient = new productProto.ProductService(
  process.env.PRODUCT_GRPC_ADDRESS || "localhost:50052",
  grpc.credentials.createInsecure()
);

export const getCustomer = (uid) => {
  return new Promise((resolve, reject) => {
    customerClient.GetCustomer(
      {
        uid: Number(uid),
      },
      (error, response) => {
        if (error) {
          return reject(error);
        }

        resolve(response);
      }
    );
  });
};

export const getProduct = (pid) => {
  return new Promise((resolve, reject) => {
    productClient.GetProduct(
      {
        pid: Number(pid),
      },
      (error, response) => {
        if (error) {
          return reject(error);
        }

        resolve(response);
      }
    );
  });
};

export const decreaseStock = (pid, qty) => {
  return new Promise((resolve, reject) => {
    productClient.DecreaseStock(
      {
        pid: Number(pid),
        qty: Number(qty),
      },
      (error, response) => {
        if (error) {
          return reject(error);
        }

        resolve(response);
      }
    );
  });
};