#!/bin/sh
# 실제 사진 세 장(전체·왼쪽·오른쪽)을 한 번에 재고 한 줄씩 요약한다. 사진과 정답은 저장소 밖에 있다.
#   sh bench/three.sh <사진 폴더> <이름표> [read.mjs 추가 인자…]
dir=$1; tag=$2; shift 2
for side in whole left right; do
  truth=$dir/truth-$side.txt; [ "$side" = whole ] && truth=$dir/truth.txt
  [ -n "$RESCORE" ] || node bench/read.mjs "$dir/$side.jpg" "$@" 2>/dev/null > "$dir/$side-$tag.txt"
  total=$(wc -l < "$truth")
  node bench/score.mjs "$truth" "$dir/$side-$tag.txt" | tail -5 | awk -v s=$side -v t=$total '
    NR==1 {n=$1; sec=$3} NR==2 {a=$3} NR==3 {b=$3} NR==4 {c=$3} NR==5 {d=$3}
    END {split(a,x,"/"); split(b,y,"/"); split(c,z,"/"); split(d,w,"/");
      printf "%-5s 정답 %2d권 → %-4s · 쓸만함 %2d · 짐작 %2d · 못읽음 %2d · %s\n", s, t, n, x[1]+y[1], z[1], w[1], sec}'
done
