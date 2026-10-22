FROM ghcr.io/steamdeckhomebrew/holo-toolchain-rust:latest

RUN pacman -Syu --noconfirm git dbus protobuf pkg-config && pacman -Scc --noconfirm

WORKDIR /build
# v0.1.8 plus adaptive ANC support (Pixel Buds Pro 2), which isn't in a tagged release yet
RUN git clone https://github.com/qzed/pbpctrl.git . && git checkout 2620367a41f92135059f637d92a2e4f427abb44e
RUN cargo build --release --bin pbpctrl
RUN strip /build/target/release/pbpctrl

ENTRYPOINT ["cp", "/build/target/release/pbpctrl"]
CMD ["/backend/out/pbpctrl"]
