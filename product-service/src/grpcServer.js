import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.resolve(
  __dirname,
  "../../proto/product.proto"
);

const packageDefinition = protoLoader.loadSync(
  PROTO_PATH,
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }
);

const productProto =
  grpc.loadPackageDefinition(packageDefinition).product;

const getProduct = async (call, callback) => {
  try {
    const { pid } = call.request;

    const result = await pool.query(
      `
      SELECT pid, pname, price, quantity
      FROM "Product"
      WHERE pid = $1
      `,
      [pid]
    );

    if (result.rows.length === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Không tìm thấy sản phẩm",
      });
    }

    const product = result.rows[0];

    callback(null, {
      pid: product.pid,
      pname: product.pname,
      price: Number(product.price),
      quantity: product.quantity,
    });
  } catch (error) {
    console.error("gRPC GetProduct error:", error);

    callback({
      code: grpc.status.INTERNAL,
      message: "Không thể lấy thông tin sản phẩm",
    });
  }
};

const decreaseStock = async (call, callback) => {
  try {
    const { pid, qty } = call.request;

    if (qty <= 0) {
      return callback({
        code: grpc.status.INVALID_ARGUMENT,
        message: "Số lượng phải lớn hơn 0",
      });
    }

    const result = await pool.query(
      `
      UPDATE "Product"
      SET quantity = quantity - $1
      WHERE pid = $2
        AND quantity >= $1
      RETURNING pid, quantity
      `,
      [qty, pid]
    );

    if (result.rows.length === 0) {
      return callback({
        code: grpc.status.FAILED_PRECONDITION,
        message: "Sản phẩm không tồn tại hoặc không đủ số lượng",
      });
    }

    callback(null, {
      pid: result.rows[0].pid,
      quantity: result.rows[0].quantity,
    });
  } catch (error) {
    console.error("gRPC DecreaseStock error:", error);

    callback({
      code: grpc.status.INTERNAL,
      message: "Không thể cập nhật tồn kho",
    });
  }
};

export const startGrpcServer = () => {
  const server = new grpc.Server();

  server.addService(
    productProto.ProductService.service,
    {
      GetProduct: getProduct,
      DecreaseStock: decreaseStock,
    }
  );

  server.bindAsync(
    "0.0.0.0:50052",
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error(
          "Product gRPC Server failed:",
          error
        );
        return;
      }

      console.log(
        `Product gRPC Server is running on port ${port}`
      );
    }
  );
};