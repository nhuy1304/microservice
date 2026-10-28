import grpc from "@grpc/grpc-js";
import protoLoader from "@grpc/proto-loader";
import path from "path";
import { fileURLToPath } from "url";
import pool from "./db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROTO_PATH = path.resolve(
  __dirname,
  "../../proto/customer.proto"
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

const customerProto =
  grpc.loadPackageDefinition(packageDefinition).customer;

const getCustomer = async (call, callback) => {
  try {
    const { uid } = call.request;

    const result = await pool.query(
      `
      SELECT
        c.uid,
        c.fullname,
        c.mid,
        m.mname,
        m.score
      FROM "Customer" c
      JOIN "MemberShip" m
        ON c.mid = m.mid
      WHERE c.uid = $1
      `,
      [uid]
    );

    if (result.rows.length === 0) {
      return callback({
        code: grpc.status.NOT_FOUND,
        message: "Không tìm thấy khách hàng",
      });
    }

    const customer = result.rows[0];

    callback(null, {
      uid: customer.uid,
      fullname: customer.fullname,
      mid: customer.mid,
      mname: customer.mname,
      score: customer.score,
    });
  } catch (error) {
    console.error("gRPC GetCustomer error:", error);

    callback({
      code: grpc.status.INTERNAL,
      message: "Không thể lấy thông tin khách hàng",
    });
  }
};

export const startGrpcServer = () => {
  const server = new grpc.Server();

  server.addService(
    customerProto.CustomerService.service,
    {
      GetCustomer: getCustomer,
    }
  );

  server.bindAsync(
    "0.0.0.0:50051",
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        console.error(
          "Customer gRPC Server failed:",
          error
        );
        return;
      }

      console.log(
        `Customer gRPC Server is running on port ${port}`
      );
    }
  );
};