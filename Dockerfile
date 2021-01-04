FROM julia:latest

ENV USER pluto
ENV USER_HOME_DIR /home/${USER}
ENV JULIA_DEPOT_PATH ${USER_HOME_DIR}/.julia
ENV NOTEBOOK_DIR ${USER_HOME_DIR}/notebooks
ENV JULIA_NUM_THREADS 100

RUN useradd -m -d ${USER_HOME_DIR} ${USER} \
    && mkdir -p ${NOTEBOOK_DIR}

COPY startup.jl ${USER_HOME_DIR}/

RUN julia -e "using Pkg; Pkg.add([\"Pluto\", \"PlutoUI\", \"Plots\"]); Pkg.precompile();" \
    && chown -R ${USER} ${USER_HOME_DIR}
USER ${USER}

EXPOSE 1234
VOLUME ${NOTEBOOK_DIR}
WORKDIR ${NOTEBOOK_DIR}

CMD [ "julia", "/home/pluto/startup.jl" ]